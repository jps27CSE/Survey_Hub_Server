const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.unrqwzu.mongodb.net/?retryWrites=true&w=majority`;
//middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// middlewares
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const usersCollection = client.db("surveyHub").collection("users");
    const surveysCollection = client.db("surveyHub").collection("surveys");
    const voteSurveys = client.db("surveyHub").collection("vote_surveys");

    app.post("/jwt", async (req, res) => {
      const user = req.body;

      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          maxAge: 60 * 60 * 1000,
        })
        .send({ success: true });
    });

    app.get("/logout", async (req, res) => {
      const user = req.body;
      console.log(user);
      res
        .clearCookie("token", { maxAge: 0, secure: true, sameSite: "none" })
        .send({ success: true });
    });

    // save user on registration or social login
    // Save or modify user email, status in DB
    app.put("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email };
      const options = { upsert: true };
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        if (user?.status === "Requested") {
          const result = await usersCollection.updateOne(
            query,
            { $set: user },
            options
          );
          return res.send(result);
        } else {
          return res.send(isExist);
        }
      }
      const result = await usersCollection.updateOne(
        query,
        {
          $set: { ...user, timestamp: Date.now() },
        },
        options
      );
      res.send(result);
    });

    // get all surveys
    app.get("/surveys", async (req, res) => {
      try {
        console.log("hit");
        const surveys = await surveysCollection.find({}).toArray();
        res.send(surveys);
      } catch (error) {
        console.error("Error fetching surveys:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // get specific surveys
    app.get("/surveys/:id", async (req, res) => {
      const id = req.params.id;
      const result = await surveysCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Get user role
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    app.post("/submit-vote", verifyToken, async (req, res) => {
      try {
        const { userEmail, surveyId, selectedOption } = req.body;

        const existingVote = await voteSurveys.findOne({
          userEmail,
          surveyId,
        });

        if (existingVote) {
          return res.send({
            message: "You have already voted for this survey",
          });
        }

        const result = await voteSurveys.insertOne({
          userEmail,
          surveyId,
          selectedOption,
          timestamp: new Date(),
        });

        res.send({ success: true, result });
      } catch (error) {
        console.error("Error submitting vote:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Check if user has voted
    app.get(
      "/has-user-voted/:userEmail/:surveyId",
      verifyToken,
      async (req, res) => {
        try {
          const userEmail = req.params.userEmail;
          const surveyId = req.params.surveyId;

          const existingVote = await voteSurveys.findOne({
            userEmail,
            surveyId,
          });

          res.send({ hasVoted: !!existingVote });
        } catch (error) {
          console.error("Error checking if user has voted:", error);
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );
    //icrement vote
    app.post("/increment-vote/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await surveysCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { votes: 1 } }
        );
        res.send(result);
      } catch (error) {
        console.error("Error incrementing vote:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/add-comment", verifyToken, async (req, res) => {
      try {
        const { surveyId, userEmail, commentContent } = req.body;

        const result = await surveysCollection.updateOne(
          { _id: new ObjectId(surveyId) },
          {
            $push: {
              comments: {
                user: userEmail,
                content: commentContent,
              },
            },
          }
        );

        res.send({ success: true, result });
      } catch (error) {
        console.error("Error adding comment:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is running on post ${port}`);
});
