const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3004, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const validatePassword = (password) => {
  return password.length > 5;
};

const authentication = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken !== undefined) {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserQuery = `
    SELECT * 
    FROM 
    user 
    WHERE username='${username}';`;

  const dbUser = await db.get(getUserQuery);

  if (dbUser === undefined) {
    if (validatePassword(password)) {
      const addUser = `
        INSERT INTO 
        user (username,password,name,gender) 
        VALUES ('${username}','${hashedPassword}','${name}','${gender}')
        `;

      await db.run(addUser);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `
    SELECT 
    * 
    FROM 
    user 
    WHERE username='${username}';`;

  const dbUser = await db.get(getUserQuery);

  if (dbUser !== undefined) {
    const isPasswordMatch = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatch) {
      const payload = { username };
      let jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

app.get("/user/tweets/feed/", authentication, async (request, response) => {
  const getTweetsQuery = `
    SELECT name,tweet,date_time
    FROM 
    user INNER JOIN tweet ON user.user_id=tweet.user_id
    ORDER BY date_time DESC
    LIMIT 4`;
  const dbTweets = await db.all(getTweetsQuery);
  response.send(dbTweets);
});

app.get("/user/following/", authentication, async (request, response) => {
  const { username } = request;

  const getFollowing = `
    SELECT 
    name 
    FROM user
    WHERE user_id IN (
    SELECT 
    follower.following_user_id
    FROM 
    user INNER JOIN follower 
    ON user.user_id=follower.follower_user_id
    WHERE user.username='${username}'
    );`;
  const dbFollowings = await db.all(getFollowing);

  response.send(dbFollowings);
});

app.get("/user/followers/", authentication, async (request, response) => {
  const { username } = request;
  console.log(username);
  const getFollower = `
    SELECT 
    user.name 
    FROM user INNER JOIN follower ON user.user_id=follower.follower_user_id
    WHERE follower.following_user_id= ( SELECT user_id FROM user WHERE username='${username}'
    );`;
  const dbFollowers = await db.all(getFollower);

  response.send(dbFollowers);
});

app.get("/tweets/:tweetId/", authentication, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;

  const getTweets = `
   SELECT tweet.tweet ,count(distinct like.user_id) AS likes,
   count(distinct reply.reply) AS replies, tweet.date_time AS dateTime
   FROM 
   (tweet INNER JOIN like 
    ON like.tweet_id=tweet.tweet_id ) AS T 
    INNER JOIN reply ON T.tweet_id=reply.tweet_id
     WHERE tweet.user_id IN (
    SELECT 
    follower.following_user_id
    FROM 
    user INNER JOIN follower 
    ON user.user_id=follower.follower_user_id
    WHERE user.username='${username}'
    ) 
     AND tweet.tweet_id='${tweetId}'
    GROUP BY tweet.tweet_id;`;
  const dbTweets = await db.all(getTweets);

  if (dbTweets.length === 0) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send(dbTweets);
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authentication,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;

    const getLikers = `
   SELECT user.name
   FROM 
   (user INNER JOIN like 
    ON like.user_id=user.user_id ) AS T
    INNER JOIN tweet ON tweet.tweet_id=T.tweet_id
    WHERE tweet.user_id IN (
    SELECT 
    follower.following_user_id
    FROM 
    user INNER JOIN follower 
    ON user.user_id=follower.follower_user_id
    WHERE user.username='${username}'
    )
   AND tweet.tweet_id='${tweetId}'
   ;`;
    const dbLikers = await db.all(getLikers);
    let likers = [];

    if (dbLikers.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      likers = dbLikers.map((liker) => liker.name);
      response.send({ likes: likers });
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authentication,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;

    const getRepliedBy = `
   SELECT user.name, reply.reply
   FROM 
   (user INNER JOIN reply 
    ON reply.user_id=user.user_id ) AS T
    INNER JOIN tweet ON tweet.tweet_id=T.tweet_id
    WHERE tweet.user_id IN (
    SELECT 
    follower.following_user_id
    FROM 
    user INNER JOIN follower 
    ON user.user_id=follower.follower_user_id
    WHERE user.username='${username}'
    )
   AND tweet.tweet_id='${tweetId}'
   ;`;
    const dbRepliedBy = await db.all(getRepliedBy);
    let repliedBy = [];

    if (dbRepliedBy.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      repliedBy = dbRepliedBy.map((reply) => ({
        name: reply.name,
        reply: reply.reply,
      }));
      response.send({ replies: repliedBy });
    }
  }
);

app.get("/user/tweets/", authentication, async (request, response) => {
  const { username } = request;

  const getTweets = `
    SELECT tweet.tweet_id, tweet.tweet ,COUNT(DISTINCT(like.like_id)) AS likes, COUNT(DISTINCT(reply.reply)) AS replies,
    tweet.date_time AS dateTime
    FROM 
   (tweet INNER JOIN like 
    ON like.tweet_id=tweet.tweet_id ) AS T
    INNER JOIN reply 
    ON T.tweet_id=reply.tweet_id 
    WHERE tweet.user_id= (
        SELECT user_id FROM user WHERE username='${username}'
    )
    GROUP BY tweet.tweet_id;`;
  const dpTweets = await db.all(getTweets);
  response.send(dpTweets);
});

app.post("/user/tweets/", authentication, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request;

  const getUserId = `
    SELECT user_id FROM user WHERE username='${username}';`;

  const userId = await db.get(getUserId);
  const { user_id } = userId;
  const date = new Date();
  const postTweet = `
    INSERT INTO tweet 
    (tweet,user_id,date_time)
    VALUES 
    (
        '${tweet}',
        '${user_id}',
        '${date}'

    );
    `;
  await db.run(postTweet);
  response.send("Created a Tweet");
});

app.delete("/tweets/:tweetId/", authentication, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;

  const getTweet = `
  SELECT *
  FROM tweet 
  WHERE user_id=(SELECT user_id FROM user WHERE username='${username}')
  AND tweet_id='${tweetId}';`;
  const dbTweet = await db.get(getTweet);
  if (dbTweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweet = `
    DELETE FROM 
    tweet 
    WHERE user_id=(SELECT user_id FROM user WHERE username='${username}')
    AND tweet_id='${tweetId}';`;
    await db.run(deleteTweet);
    response.send("Tweet Removed");
  }
});

module.exports = app;
