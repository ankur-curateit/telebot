const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const axios = require("axios");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const token = process.env.TELEGRAM_TOKEN;

const bot = new TelegramBot(token, { polling: true });

let loginState = {};
let apiResponse = {};
let sessionToken = 0;
let sessionId = 0;

async function fetchOpenGraphData(url) {
  const response = await fetch(url);
  const html = await response.text();

  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const ogData = {};

  const metaTags = doc.querySelectorAll('meta[property^="og:"]');
  metaTags.forEach((tag) => {
    ogData[tag.getAttribute("property")] = tag.getAttribute("content");
  });

  return ogData;
}

async function unfilteredCollectionId() {
  const authToken = sessionToken;
  console.log("authtoken from unfilteredCollectionId ", authToken);

  const url = `${process.env.CURATEIT_API_URL}/api/get-user-collections`;
  const options = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (data && data.length > 0) {
      console.log("ID of the first collection:", data[0].id);
      return data[0].id;
    } else {
      console.log("No collections found.");
    }
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

const searchGem = async (chatId, query) => {
  console.log("Search Gem called with params : ", chatId, " : ", query);
  const authToken = sessionToken;
  console.log("authtoken from unfilteredCollectionId ", authToken);

  const url = `${process.env.CURATEIT_API_URL}/api/filter-search?filterby=title&queryby=${query}&termtype=contains&page=1&perPage=20`;
  const options = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log("data : ", data);
    if (data && data.totalCount > 0) {
      console.log("Full Title :", data?.finalRes[0]?.title);
      const res = {
        title: data?.finalRes[0]?.title,
        url: data?.finalRes[0]?.url,
      };
      bot.sendMessage(
        chatId,
        `Found a Gem called ${res.title}, url : ${res.url}`
      );
    } else {
      console.log("No gem found.");
      bot.sendMessage(chatId, "No Gem Found");
    }
  } catch (error) {
    console.error("Error fetching gem data:", error);
  }
};

const saveLink = async (chatId, link) => {
  console.log(`saveLink called with link: ${link}`);
  const url0 = new URL(link);
  const hostname = url0.hostname;

  // Check if the hostname ends with 'curateit.com'
  if (hostname.endsWith("curateit.com")) {
    // Exit the function if the link is from curateit.com or its subdomains
    return;
  }
  let ogData = await fetchOpenGraphData(link);

  let title = ogData["og:title"];
  let desc = ogData["og:description"];
  let url = link;
  let imgUrl = ogData["og:image"];
  let collectionId = await unfilteredCollectionId();
  console.log("collectionId : ", collectionId);

  const baseUrl = `${process.env.CURATEIT_API_URL}/api/gems?populate=tags`;
  const authToken = sessionToken;
  if (!authToken || authToken == 0) {
    bot.sendMessage(chatId, "Invalid User, Please relogin");
    return;
  }
  console.log("authToken from saveLink : ", authToken);
  const body = {
    data: {
      title: title,
      description: desc,
      expander: [],
      media_type: "Link",
      author: sessionId,
      url: url,
      media: {
        covers: [imgUrl],
      },
      metaData: {
        type: "Link",
        title: title,
        icon: "",
        url: url,
        covers: [imgUrl],
        isYoutube: false,
      },
      collection_gems: collectionId,
      remarks: "",
      tags: [],
      is_favourite: false,
      showThumbnail: true,
    },
  };

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseData = await response.json();
    console.log("Successfully saved link:", link);
    bot.sendMessage(chatId, "Successfully saved the link");
  } catch (error) {
    bot.sendMessage(chatId, "Could not save the link, please try again");
    console.error("Error saving link:", error);
  }
};

bot.onText(/\/login/, (msg) => {
  const chatId = msg.chat.id;
  loginState[chatId] = { step: "email" };
  bot.sendMessage(chatId, "Please enter your email");
});

bot.on("message", async (msg) => {
  // Handles Login
  const chatId = msg.chat.id;
  // if (!sessionToken || sessionToken == 0) {
  //   bot.sendMessage(chatId, "Invalid User, Please relogin");
  //   return;
  // }

  if (loginState[chatId] && loginState[chatId].step === "email") {
    loginState[chatId] = { step: "password", email: msg.text };
    bot.sendMessage(chatId, "Please enter your password");
    return;
  }

  if (loginState[chatId] && loginState[chatId].step === "password") {
    const email = loginState[chatId].email;
    const password = msg.text;

    try {
      const response = await axios.post(
        `${process.env.CURATEIT_API_URL}/api/auth/local`,
        {
          identifier: email,
          password: password,
        }
      );

      apiResponse[chatId] = response.data; // Store the API response
      sessionToken = response.data.jwt;
      sessionId = response.data.user.id;
      console.log("sessionId : ", sessionId);
      console.log("sessionToken : ", sessionToken);
      bot.sendMessage(chatId, "Login Successful");
    } catch (error) {
      if (error.response && error.response.status === 400) {
        bot.sendMessage(chatId, "Invalid credentials");
      } else {
        bot.sendMessage(chatId, "Login failed. Please try again.");
      }
    }

    delete loginState[chatId];
    return;
  }
});

const systemMessage = {
  role: "system",
  content:
    "You are CurateitAI, a productivity assistant and your job is to help users with their productivity.",
};

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Welcome To CurateitAI");
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (msg.text === "/start" || msg.text === "/login") {
    return;
  }
  bot.sendMessage(chatId, "Received your message");
});