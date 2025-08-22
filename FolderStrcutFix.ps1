# Create target folders
New-Item -ItemType Directory -Path backend, frontend

# Move backend files from src
Move-Item -Path "src/Config", "src/Models", "src/Services" -Destination "backend"

# Move backend root files
Move-Item -Path "Program.cs", "WsHub.cs", "SentaliApp.csproj", "SentaliApp.sln" -Destination "backend"

# Move frontend files
Move-Item -Path "public", "src", "scripts", "index.html", "package.json", "package-lock.json" -Destination "frontend"

# Rename main.js to main.ts
Rename-Item -Path "frontend/src/main.js" -NewName "main.ts"

# Skip .archive move — already in root
Write-Host ".archive already in root — no move needed."