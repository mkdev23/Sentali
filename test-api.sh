#!/bin/bash

echo "=== Azure AI Agent API Test ==="
echo "Testing the GPT service with a real API call"

# Set environment variables from the Azure configuration
export AZURE_AI_AGENT_ID="asst_OtwmJTEeIjau1YUZL10peovx"
export AZURE_AI_PROJECT_ENDPOINT="https://sentali-openai-project-resource.services.ai.azure.com/api/projects/sentali-openai-project"
export AZURE_AI_PROJECT_KEY="7WjDfju9MXRco6asOOljc12qXhnlQETiTB2RzG5nA3pq2qUsbujiJQQJ99BIACHYHv6XJ3w3AAAAACOGCFlY"
export AZURE_OPENAI_ENDPOINT="https://eastus.api.cognitive.microsoft.com/"
export AZURE_OPENAI_DEPLOYMENT="sentali-base"
export AZURE_TTS_KEY="F2fOeM0XIR7pV0FHLHpk3UKi6TYmWgCpVt2l9DVp7zlL4xUGqFtNJQQJ99BIACHYHv6XJ3w3AAAAACOGCFlY"
export AZURE_TTS_REGION="eastus"
export BASE_URL="https://sentali-app-6926.azurewebsites.net"
export PORT="8080"

cd /home/runner/work/Sentali/Sentali/backend

echo "Starting application in background..."
dotnet run --configuration Release > app.log 2>&1 &
APP_PID=$!

# Wait for the app to start
echo "Waiting for application to start..."
sleep 15

# Check if the app is running
if ! kill -0 $APP_PID 2>/dev/null; then
    echo "❌ Application failed to start. Check app.log for errors:"
    cat app.log
    exit 1
fi

echo "Application started. Testing API endpoint..."

# Test the GPT API endpoint
echo "Making API call to /api/tts..."
curl -X POST \
  -H "Content-Type: application/json" \
  -d '"Hello, this is a test message. Can you respond?"' \
  http://localhost:8080/api/tts \
  --max-time 60 \
  --connect-timeout 10

echo ""
echo ""

# Stop the application
echo "Stopping application..."
kill $APP_PID
wait $APP_PID 2>/dev/null

echo "Application logs:"
cat app.log