import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URL);

// Directly access db and collections from client
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

app.get('/books', async (req, res) => {
  try {
    const cursor = books.find({});
    const allBooks = await cursor.toArray();

    res.status(200).send(allBooks);
  } catch (err) {
    res.status(500).send({
      error: "Failed to fetch books",
      details: err.message
    });
  }
});

app.post('/books', async (req, res) => {
  try {
    const newBook = req.body;
    console.log("Adding new book:", newBook);
    const result = await books.insertOne(newBook);
    res.status(201).send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to add book", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
