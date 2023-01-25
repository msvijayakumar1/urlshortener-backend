import express from "express";
import { MongoClient } from "mongodb";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import bcrypt, { compare } from "bcrypt";
import jwt from "jsonwebtoken";
dotenv.config();
import cors from "cors";
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT;
const MONGO_URL = process.env.MONGO_URL;
import shortId from "shortid";
app.use(express.urlencoded({extended:false}))
async function createConnection() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  return client;
}
app.get('/urlsData', async(req,res)=>{
  const client = await createConnection();
  const urlsData = await client.db("urlshortener").collection("urls").aggregate([{
    "$sort": {
      "createdAt": -1
    }
  }]).toArray();
  res.send(urlsData);
})
app.post('/shortUrl', async (req,res)=>{
  const {fullUrl} = req.body;
  const short = shortId.generate();
  const date = new Date().toISOString().slice(0,10);
  const client = await createConnection();
  const urlsData = await client.db("urlshortener").collection("urls").insertOne({
    full:fullUrl, short:short,clicks:0, createdAt : date});
  res.send({short:short});
})
app.post("/data", async (request, response) => {
  const { email } = request.body;
  const client = await createConnection();
  const user = await client.db("urlshortener").collection("passwords").find({ email: email }).toArray();
  if (user.length > 0) {
    response.send({ message: "This email is not available. Try another" });
  } else {
    response.send({ message: "This email is available" });
  }
})
app.get("/urlGraph/monthly", async (request, response) => {
  const client = await createConnection();
  const urlsData = await client.db("urlshortener").collection("urls").aggregate([
    {
      "$group": {
        "_id": {
          $substr: [
            "$createdAt",
            5,
            2
          ]
        },
        "noOfUrls": {
          "$sum": 1
        }
      }
    },
    {
      "$sort": {
        "_id": 1
      }
    },
    {
      "$project": {
        date: "$_id",
        noOfUrls: 1,
        _id: 0
      }
    }
  ]).toArray();
  response.send(urlsData);
})
app.get("/urlGraph/daily/:month", async (request, response) => {
const {month} = request.params;
const startDate = `2021-${month}-00`
const endDate = `2021-${month}-32`
  const client = await createConnection();
  const urlsData = await client.db("urlshortener").collection("urls").aggregate([
    {
      "$match": {
        "createdAt": {
          $gt: startDate,
          $lt: endDate
        }
      }
    },
    {
      "$group": {
        "_id": {
          $substr: [
            "$createdAt",
            8,
            2
          ]
        },
        "noOfUrls": {
          "$sum": 1
        }
      }
    },
    {
      "$sort": {
        "_id": 1
      }
    },
    {
      "$project": {
        date: "$_id",
        noOfUrls: 1,
        _id: 0
      }
    }
  ]).toArray();
  response.send(urlsData);
})
app.get("/", async (request, response) => {
  response.send("please append the end points");
})
app.post("/users/forgot", async (request, response) => {
  const { email } = request.body;
  const currentTime = new Date();
  const expireTime = new Date(currentTime.getTime() + 5 * 60000);
  const client = await createConnection();
  const user = await client.db("urlshortener").collection("passwords").find({ email: email }).toArray();
  if (user.length > 0) {
    const token = jwt.sign({ email: email }, process.env.MY_SECRET_KEY);
    await client.db("urlshortener").collection("passwords").updateOne({ email: email },
      {
        $set:
          { token: token, expireTime: expireTime }
      });
    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
        clientId: process.env.OAUTH_CLIENTID,
        clientSecret: process.env.OAUTH_CLIENT_SECRET,
        refreshToken: process.env.OAUTH_REFRESH_TOKEN
      }
    });
    let mailOptions = {
      from: 'msvijayakumar121@gmail.com',
      to: email,
      subject: 'Reset Password link',
      html:
      '<a href = "https://superlative-eclair-3cc3af.netlify.app/retrieveAccount/' + email + '/' + token + '"> Reset Password Link</a>'
    };
    transporter.sendMail(mailOptions, async function (err, data) {
      if (err) {
        response.send("Error " + err);
      } else {
        response.send({ message: "Email sent successfully" });
      }
    });
  }
  else {
    response.send({ message: "This email is not registered" });
  }
})
app.get("/retrieveAccount/:email/:token", async (request, response) => {
  const currentTime = new Date();
  const { email, token } = request.params;
  const client = await createConnection();
  const user = await client.db("urlshortener").collection("passwords").find({ email: email }).toArray();
  if (user.length > 0) {
    const tokenInDB = user[0].token;
    if (token == tokenInDB) {
      if (currentTime > user[0].expireTime) {
        response.send({ message: "link expired" })
      } else {
        response.send({ message: "retrieve account" });
      }

    } else {
      response.send({ message: "invalid authentication" });
    }
  }
  else {
    response.send({ message: "Invalid account" });
  }
})
app.put("/resetPassword/:email/:token", async (request, response) => {
  const currentTime = new Date();
  const { email, token } = request.params;
  const { newPassword } = request.body;
  const client = await createConnection();
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  const user = await client.db("urlshortener").collection("passwords").find({ email: email, token: token }).toArray();
  if (!user[0]) {
    response.send({ message: "invalid url" });
  } else {
    const expireTime = user[0].expireTime;
    if (currentTime > expireTime) {
      response.send({ message: "link expired" });
    } else {
      const result = await client.db("urlshortener").collection("passwords").updateOne({
        email: email,
        token: token
      },
        {
          $set: {
            password: hashedPassword
          },
          $unset: {
            token: "",
            expireTime: ""
          }
        });
      response.send({ message: "password updated" });
    }
  }
})
app.put("/activateAccount/:email/:token", async (request, response) => {
  const { email, token } = request.params;
  const client = await createConnection();
  const user = await client.db("urlshortener").collection("inactive").find({ email: email, token: token }).toArray();
  if (user.length > 0) {
    await client.db("urlshortener").collection("passwords").insertOne({
      email: user[0].email, password: user[0].password, firstName: user[0].firstName, lastName: user[0].lastName
    });
    await client.db("urlshortener").collection("inactive").deleteMany({ email: email, token: token })
    response.send({ message: 'activate account' });
  } else {
    response.send({ message: 'invalid url' });
  }

})
app.post("/users/SignUp", async (request, response) => {
  const { email, password, firstName, lastName } = request.body;
  const token = jwt.sign({ email: email }, process.env.MY_SECRET_KEY);
  const url = `https://superlative-eclair-3cc3af.netlify.app//activateAccount/${email}/${token}`;
  const client = await createConnection();
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  const result = await client.db("urlshortener").collection("inactive").insertOne({
    email: email, password: hashedPassword, firstName: firstName, lastName: lastName, token: token
  });
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
      clientId: process.env.OAUTH_CLIENTID,
      clientSecret: process.env.OAUTH_CLIENT_SECRET,
      refreshToken: process.env.OAUTH_REFRESH_TOKEN
    }
  });
  let mailOptions = {
    from: 'msvijayakumar121@gmail.com',
    to: email,
    subject: 'Account activation link',
    html:
      `<a href =  "${url}">Click this link to activate the account </a>`
  };
  transporter.sendMail(mailOptions, async function (err, data) {
    if (err) {
      response.send("Error " + err);
    } else {
      response.send({ message: 'Activation link is sent to the mail. Please click the link to complete the registration' });
    }
  });

})
app.post("/users/Login", async (request, response) => {
  const { email, password } = request.body;
  const token = jwt.sign({ email: email }, process.env.MY_SECRET_KEY);
  const client = await createConnection();
  const user = await client.db("urlshortener").collection("passwords").find({ email: email }).toArray();
  if (user.length > 0) {
    const passwordstoredindb = user[0].password;
    const loginFormPassword = password;
    const ispasswordmatch = await bcrypt.compare(loginFormPassword, passwordstoredindb);
    if (ispasswordmatch) {
      response.send({ message: "successful login!!!", token:token });
    } else {
      response.send({ message: "invalid login" });
    }
  } else {
    response.send({ message: "invalid login" });
  }
})
app.get('/:short', async(req,res)=>{
  const {short} = req.params;
  const client = await createConnection();
  const url = await client.db("urlshortener").collection("urls").findOne({short: short});
  if(url == null) return res.sendStatus(404)
  let clicks = url.clicks;
  await client.db("urlshortener").collection("urls").updateOne({short: short},{$set:{clicks : clicks + 1}});
  let full = url.full
  res.send({full:full});
})
app.listen(PORT, () => console.log("The server is started"));

//https://urlshortener-2425.netlify.app/