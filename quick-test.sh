#!/bin/bash

echo "=== Quick Configuration Test ==="
echo "Testing if the application starts with Azure configuration"

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

echo "Testing application startup..."
timeout 30s dotnet run --configuration Release &
APP_PID=$!

# Wait a moment for the app to start
sleep 10

# Test the health endpoint
echo "Testing health endpoint..."
curl -s http://localhost:8080/health

# Check if the process is still running
if kill -0 $APP_PID 2>/dev/null; then
    echo ""
    echo "✅ Application started successfully!"
    echo "The configuration fixes appear to be working."
    kill $APP_PID
else
    echo ""
    echo "❌ Application failed to start or crashed."
    echo "Check the logs above for errors."
fi

wait $APP_PID 2>/dev/null