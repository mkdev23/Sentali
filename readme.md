# 🛡️ Sentali — Security‑Focused AI Agent

**Sentali** is a professional, approachable AI agent represented by a **blue alien avatar**.  
It interacts with users via **voice** and **visual cues** in a **web‑based Unity environment**,  
with a strong emphasis on **security‑by‑design**, **modular architecture**, and **future‑proof workflows**.

---

## 📜 Overview

Sentali is designed for:
- **Secure, real‑time interaction** between users and AI
- **Expressive avatar rendering** with biomechanical realism
- **Cross‑platform compatibility** (desktop & mobile browsers)
- **Modular backend/frontend separation** for maintainability

The avatar is **visually engaging** yet **professional**,  
making it suitable for enterprise, education, and public‑facing applications.

---

## ✨ Features

- 🎙 **Voice Interaction** — Real‑time speech recognition & synthesis
- 🧠 **AI‑Driven Responses** — Context‑aware, secure conversational logic
- 👽 **3D Avatar** — Blue alien with natural posing & facial expressions
- 🌐 **Web‑Based Unity Integration** — Runs in modern browsers
- 🔒 **Security‑First Architecture** — Input validation, sandboxed execution
- ⚙ **Modular Codebase** — Easy to extend, refactor, and onboard new devs

---

## 🛠 Tech Stack

Layer

Technology

Frontend

Unity WebGL, Three.js, WebSocket client

Backend

.NET 9, C#, WebSocket server

AI Logic

Modular service layer (secure‑by‑default)

Assets

VRM avatars, WAV audio files, HDRI backgrounds

Build/CI

GitHub Actions, Docker (optional)

📂 Project Structure

SentaliApp/
├── backend/           # .NET backend services
├── frontend/          # Unity WebGL + Three.js frontend
│   ├── public/Assets/ # VRM, WAV, HDRI files
│   └── src/           # Scripts, shaders, UI logic
├── .gitignore
├── LICENSE
└── README.md

🚀 Getting Started

1. Clone the repository

git clone https://github.com/mkdev23/Sentali.git
cd Sentali/SentaliApp

2. Install dependencies

Frontend

cd frontend
npm install

Backend

cd backend
dotnet restore

3. Run locally

Frontend

npm run dev

Backend

dotnet run

🐳 Optional: Run with Docker

docker-compose up --build

(Requires Docker Desktop)

🔐 Security Notes

All external inputs are validated before processing

No hard‑coded secrets — use .env files (excluded from Git)

WebSocket communication is encrypted (WSS)

Modular architecture allows for isolated security audits

🤝 Contributing

Fork the repo

Create a feature branch:

git checkout -b feature/your-feature

Commit changes with clear messages

Push to your fork and open a Pull Request

📄 License

This project is licensed under the MIT License — see the LICENSE file for details.

📬 Contact

For collaboration or inquiries:GitHub: mkdev23Maintainer: Julius