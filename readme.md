🛡️ Sentali — Security‑Focused AI AgentSentali is a professional, approachable AI agent represented by a blue alien avatar. It interacts with users via voice and visual cues in a web‑based Unity environment, with a strong emphasis on security‑by‑design, modular architecture, and future‑proof workflows.

📜 OverviewSentali is designed for:

Secure, real‑time interaction between users and AI

Expressive avatar rendering with biomechanical realism

Cross‑platform compatibility (desktop & mobile browsers)

Modular backend/frontend separation for maintainability

The avatar is visually engaging yet professional, making it suitable for enterprise, education, and public‑facing applications.

✨ Features

🎙 Voice Interaction — Real‑time speech recognition & synthesis

🧠 AI‑Driven Responses — Context‑aware, secure conversational logic

👽 3D Avatar — Blue alien with natural posing & facial expressions

🌐 Web‑Based Unity Integration — Runs in modern browsers

🔒 Security‑First Architecture — Input validation, sandboxed execution

⚙ Modular Codebase — Easy to extend, refactor, and onboard new devs

🧠 Core LLM FunctionalitySentali is not just conversational — it's a security-focused Copilot.🔐 Security Intelligence & Reasoning

Security Q&A — Respond to user queries about secure coding, threat models, best practices

Threat Intel Integration — Pull from simulated APIs (CISA, MITRE, OTX)

Code Generation & Review — Generate secure code snippets, annotate with inline security suggestions

Static Analysis Tools — Bandit, ESLint, Semgrep integration to flag issues

Threat Landscape Awareness — Real-time queries about vulnerabilities, CVEs, attack vectors

Feed Summarization — Summarize threat feeds and suggest mitigations

🧑‍🎤 Multi-Modal InteractionSentali integrates deeply with voice and avatar animation.

Azure TTS/STT — Voice synthesis with emotional SSML tuning; speech-to-text for voice input

Tone Detection — Azure Text Analytics to classify emotional tone

Expression Mapping — Map tone to avatar blendshapes

Avatar Sync — Trigger gestures, expressions, and lip sync based on agent output

Animator Controller — Manage speaking/listening states

🧩 Modular OrchestrationSentali is scalable and team-friendly, built on Azure Functions.

Function Modules:

LLM + security context

Sentiment + emotion classification

Blendshape trigger logic

Store user-agent exchanges in Cosmos DB

Copilot Studio Integration — Augloop prompt engineering, plugin orchestration

Telemetry — Application Insights

♿ Accessibility & UX IntelligenceSentali supports inclusive design via a Fluent UI webapp.

Contrast-aware responses

Screen reader-friendly output formatting

Keyboard navigation and semantic HTML

Multilingual support (optional)

🧑‍🤝‍🧑 Multi-Agent ExpansionSentali supports multiple personalities or roles:

Helper Agent — Friendly, supportive, guides users

Analyst Agent — Technical, precise, security-focused

Challenger Agent — Provokes deeper thinking, flags risky assumptions

Each agent can have:

Distinct tone and expression mapping

Unique avatar cues (e.g., color shift, posture)

Separate Azure Function logic

🛠 Tech Stack

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

📂 Project StructureSentaliApp/
├── backend/           # .NET backend services
├── frontend/          # Unity WebGL + Three.js frontend
│   ├── public/Assets/ # VRM, WAV, HDRI files
│   └── src/           # Scripts, shaders, UI logic
├── .gitignore
├── LICENSE
└── README.md

🚀 Getting Started1. Clone the repositorygit clone https://github.com/mkdev23/Sentali.git
cd Sentali/SentaliApp2. Install dependenciesFrontendcd frontend
npm installBackendcd backend
dotnet restore3. Run locallyFrontendnpm run devBackenddotnet run

🐳 Optional: Run with Dockerdocker-compose up --build(Requires Docker Desktop)

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

📄 LicenseThis project is licensed under the MIT License — see the LICENSE file for details.

📬 ContactFor collaboration or inquiries: GitHub: mkdev23 Maintainer: Julius