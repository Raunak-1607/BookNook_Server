import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";
import { jwtVerify, createRemoteJWKSet, createLocalJWKSet } from 'jose'

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URL);
const db = client.db("BookNook");
const books = db.collection("books");
const borrowedBooks = db.collection("borrowbooks");
const jwksCollection = db.collection("jwks");

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).send({ error: "No token provided" });
  }

  const clientUrl = process.env.CLIENT_URL ? process.env.CLIENT_URL.trim() : "";

  // 1. If CLIENT_URL is a public web URL (not localhost), try remote JWKS
  if (clientUrl && !clientUrl.includes("localhost") && !clientUrl.includes("127.0.0.1")) {
    try {
      const JWKS = createRemoteJWKSet(new URL(`${clientUrl}/api/auth/jwks`));
      const { payload } = await jwtVerify(token, JWKS);
      req.user = payload;
      return next();
    } catch (remoteErr) {
      console.warn("Remote JWKS failed, trying database keys:", remoteErr.message);
    }
  }

  // 2. Database fallback: directly verify with JWKS public keys in shared MongoDB
  try {
    const dbKeys = await jwksCollection.find({}).toArray();
    if (dbKeys.length > 0) {
      const formattedKeys = dbKeys.map((k) => {
        const parsed = typeof k.publicKey === "string" ? JSON.parse(k.publicKey) : k.publicKey;
        return {
          ...parsed,
          kid: k._id.toString(),
          alg: k.alg || "EdDSA",
          crv: k.crv || "Ed25519",
        };
      });
      const localJWKS = createLocalJWKSet({ keys: formattedKeys });
      const { payload } = await jwtVerify(token, localJWKS);
      req.user = payload;
      return next();
    }

    throw new Error("No JWKS keys found in database");
  } catch (err) {
    console.error("JWT verification error:", err);
    return res.status(403).send({ error: "Invalid token" });
  }
};

async function run() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}
run();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// All books (public)
app.get("/books", async (req, res) => {
  try {
    const allBooks = await books.find({}).toArray();
    res.status(200).send(allBooks);
  } catch (err) {
    res
      .status(500)
      .send({ error: "Failed to fetch books", details: err.message });
  }
});


// Single book by ID (public)
app.get("/books/detail/:id", async (req, res) => {
  try {
    const result = await books.findOne({ _id: new ObjectId(req.params.id) });
    if (!result) {
      return res.status(404).send({ error: "Book not found" });
    }
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Invalid ID", details: err.message });
  }
});


app.get("/books/:email", verifyToken, async (req, res) => {
  try {
    const result = await books.find({ email: req.params.email }).toArray();
    res.send(result);
  } catch (err) {
    res
      .status(500)
      .send({ error: "Failed to fetch user books", details: err.message });
  }
});

app.get("/borrowed-books/:email", verifyToken, async (req, res) => {
  try {
    const result = await borrowedBooks
      .find({
        email: req.params.email,
        status: "Borrowed",
      })
      .toArray();

    res.send(result);
  } catch (err) {
    res.status(500).send({
      error: "Failed to fetch borrowed books",
      details: err.message,
    });
  }
});


app.patch("/borrowed-books/:id/return", verifyToken, async (req, res) => {
  try {
    const { email } = req.body;
    const borrowId = new ObjectId(req.params.id);

    const borrowedBook = await borrowedBooks.findOne({
      _id: borrowId,
      email,
      status: "Borrowed",
    });

    if (!borrowedBook) {
      return res.status(404).send({
        error: "Active borrowed book not found.",
      });
    }

    const returnUpdate = await borrowedBooks.updateOne(
      {
        _id: borrowId,
        email,
        status: "Borrowed",
      },
      {
        $set: {
          status: "Returned",
          returnDate: new Date(),
        },
      },
    );

    if (returnUpdate.modifiedCount === 0) {
      return res.status(409).send({
        error: "This book has already been returned.",
      });
    }

    const bookUpdate = await books.updateOne(
      { _id: borrowedBook.bookId },
      { $inc: { copies: 1 } },
    );

    if (bookUpdate.modifiedCount === 0) {
   
      await borrowedBooks.updateOne(
        { _id: borrowId },
        { $set: { status: "Borrowed" }, $unset: { returnDate: "" } },
      );

      return res.status(404).send({
        error: "Original book was not found.",
      });
    }

    res.send({
      success: true,
      message: "Book returned successfully.",
    });
  } catch (err) {
    res.status(500).send({
      error: "Failed to return book",
      details: err.message,
    });
  }
});
// Add a book
app.post("/books", verifyToken, async (req, res) => {
  try {
    const book = {
      ...req.body,
      copies: Number(req.body.copies),
      totalCopies: Number(req.body.totalCopies ?? req.body.copies),
    };

    if (!Number.isInteger(book.copies) || book.copies < 1) {
      return res
        .status(400)
        .send({ error: "Copies must be a positive number." });
    }

    const result = await books.insertOne(book);
    res.status(201).send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to add book", details: err.message });
  }
});

app.post("/borrowed-books", verifyToken, async (req, res) => {
  try {
    const { bookId, userName, email } = req.body;

    const existingBorrow = await borrowedBooks.findOne({
      bookId: new ObjectId(bookId),
      email,
      status: "Borrowed",
    });

    if (existingBorrow) {
      return res.status(409).send({
        error: "You have already borrowed this book.",
      });
    }

    const updatedBook = await books.findOneAndUpdate(
      {
        _id: new ObjectId(bookId),
        copies: { $gt: 0 },
      },
      {
        $inc: { copies: -1 },
      },
      {
        returnDocument: "after",
      },
    );

    
    if (!updatedBook) {
      return res.status(400).send({
        error: "Sorry, no available copies left.",
      });
    }

    const borrowRecord = await borrowedBooks.insertOne({
      bookId: new ObjectId(bookId),
      bookTitle: updatedBook.title,
      userName,
      email,
      borrowDate: new Date(),
      status: "Borrowed",
    });

    res.status(201).send({
      success: true,
      message: "Book borrowed successfully",
      availableCopies: updatedBook.copies,
      borrowId: borrowRecord.insertedId,
    });
  } catch (err) {
    res.status(500).send({
      error: "Failed to borrow the book",
      details: err.message,
    });
  }
});
app.patch("/books/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const updatedBook = req.body;
  try {
    const result = await books.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedBook },
    );
    res.send(result);
  } catch (err) {
    res
      .status(500)
      .send({ error: "Failed to update book", details: err.message });
  }
});

app.delete("/books/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };
  try {
    const result = await books.deleteOne(query);
    res.send(result);
  } catch (err) {
    res
      .status(500)
      .send({ error: "Failed to delete book", details: err.message });
  }
});

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
}

export default app;