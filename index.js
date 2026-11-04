import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URL);
const db = client.db('BookNook');
const books = db.collection('books');

async function run() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}
run();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

// All books
app.get('/books', async (req, res) => {
  try {
    const allBooks = await books.find({}).toArray();
    res.status(200).send(allBooks);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch books", details: err.message });
  }
});

// ✅ Single book by ID  — /books/detail/:id
app.get('/books/detail/:id', async (req, res) => {
  try {
    const result = await books.findOne({ _id: new ObjectId(req.params.id) });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Invalid ID", details: err.message });
  }
});

// ✅ My Books — books added by this user email — /books/:email
app.get('/books/:email', async (req, res) => {
  try {
    const result = await books.find({ email: req.params.email }).toArray();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch user books", details: err.message });
  }
});

// Add a book
app.post('/books', async (req, res) => {
  try {
    const result = await books.insertOne(req.body);
    res.status(201).send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to add book", details: err.message });
  }
});

app.patch('/books/:id', async (req, res) => {
  const {id} = req.params;
  const updatedBook = req.body;
  try{
    const result = await books.updateOne({ _id: new ObjectId(id) }, { $set: updatedBook });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to update book", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});