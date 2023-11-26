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
    const surveyReportsCollection = client
      .db("surveyHub")
      .collection("survey_reports");

    //for admins
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "admin") {
        return res.status(401).send({ message: "unauthorized access" });
      }
      next();
    };

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
        const { userName, userEmail, surveyId, selectedOption } = req.body;

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
          userName,
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
    // Increment vote endpoint
    app.post("/increment-vote/:id/:option?", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const option = req.params.option;

        // Create the update object
        const updateObject = option
          ? { $inc: { [`${option}Votes`]: 1, votes: 1 } } // Increment specific option and overall votes
          : { $inc: { votes: 1 } }; // Increment overall votes

        // Assuming you have a surveysCollection defined
        const result = await surveysCollection.updateOne(
          { _id: new ObjectId(id) },
          updateObject
        );

        res.send(result);
      } catch (error) {
        console.error("Error incrementing vote:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    //add comment
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

    // get all users
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    //update user role
    app.put("/users/update/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // create-survey endpoint
    app.post("/create-survey", async (req, res) => {
      try {
        const { title, description, options, category } = req.body;

        const result = await surveysCollection.insertOne({
          title,
          description,
          options,
          category,
          votes: 0,
          YesVotes: 0,
          NoVotes: 0,
          like: 0,
          dislike: 0,
          comments: [],
          timestamp: new Date(),
        });

        res.send({ result });
      } catch (error) {
        console.error("Error creating survey:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Increment like endpoint
    app.post("/increment-like/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const result = await surveysCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { like: 1 } }
        );

        res.send(result);
      } catch (error) {
        console.error("Error incrementing like:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Increment dislike endpoint
    app.post("/increment-dislike/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const result = await surveysCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { dislike: 1 } }
        );

        res.send(result);
      } catch (error) {
        console.error("Error incrementing dislike:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Post survey report endpoint
    app.post("/post-report/:surveyId", verifyToken, async (req, res) => {
      try {
        const { userEmail, reportContent } = req.body;
        const surveyId = req.params.surveyId;

        const result = await surveyReportsCollection.insertOne({
          surveyId: new ObjectId(surveyId),
          userEmail,
          reportContent,
          timestamp: new Date(),
        });

        res.send({ success: true, result });
      } catch (error) {
        console.error("Error submitting report:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //survey votes
    app.get("/survey-votes", async (req, res) => {
      try {
        const surveyVotes = await voteSurveys.find({}).toArray();
        res.send(surveyVotes);
      } catch (error) {
        console.error("Error fetching survey votes:", error);
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
