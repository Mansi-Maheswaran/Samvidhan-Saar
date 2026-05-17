import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cors());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://0.0.0.0:27017/samvidhan";

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 2000, // Timeout after 2 seconds instead of default 30s
})
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => {
    console.error("ℹ️ MongoDB Connection Info: Could not connect to the database. If you are running locally, make sure MongoDB is started.");
    console.log("   The app will still start, but database-dependent features may fail until the connection is established.");
  });

// Schemas
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  progress: {
    userId: String,
    completedArticles: [String],
    bookmarkedArticles: [String],
    totalPoints: Number,
    quizAttempts: [{
      quizId: String,
      score: Number,
      difficulty: String,
      timestamp: Number
    }]
  }
});

const User = mongoose.model("User", userSchema);

const constitutionSchema = new mongoose.Schema({
  parts: Array
});

const Constitution = mongoose.model("Constitution", constitutionSchema);

// API Routes
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, name, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User already exists" });
    
    const newUser = new User({ 
      email, 
      name, 
      password, 
      isAdmin: email === "admin@samvidhan.in",
      progress: {
        userId: email,
        completedArticles: [],
        bookmarkedArticles: [],
        totalPoints: 0,
        quizAttempts: []
      }
    });
    await newUser.save();
    res.json(newUser);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find({}, "-password");
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/users/:email/progress", async (req, res) => {
  try {
    const { email } = req.params;
    const { progress } = req.body;
    const user = await User.findOneAndUpdate({ email }, { progress }, { new: true });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/constitution", async (req, res) => {
  try {
    const data = await Constitution.findOne();
    res.json(data?.parts || []);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/constitution", async (req, res) => {
  try {
    const { parts } = req.body;
    await Constitution.deleteMany({});
    const newData = new Constitution({ parts });
    await newData.save();
    res.json(newData.parts);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// AI ROUTES
app.post("/api/ai/generate-facts", async (req, res) => {
  try {
    const { sectorName } = req.body;
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ message: "GEMINI_API_KEY is not configured on the server." });
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Generate 2-3 daily facts/news for the ${sectorName} sector in India. 
    Include at least one scam alert with a solution if relevant.
    Format as JSON array: [{ id, title, content, type (news/scam), solution?, imageUrl, example }].`;

    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });
    
    res.json(JSON.parse(result.text || "[]"));
  } catch (err: any) {
    res.status(500).json({ message: err.message || "Failed to generate facts" });
  }
});

app.post("/api/ai/text-to-speech", async (req, res) => {
  try {
    const { text } = req.body;
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ message: "GEMINI_API_KEY is not configured on the server." });
    }

    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ role: 'user', parts: [{ text }] }],
      config: {
        responseModalalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      },
    });

    const base64Audio = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio data received");
    res.json({ audioData: base64Audio });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "Failed to generate audio" });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();
