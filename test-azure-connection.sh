#!/bin/bash

echo "=== Azure AI Connection Test ==="
echo "Testing the configuration fixes for Azure AI Agent connection"
echo ""

# Set environment variables from the Azure configuration
export AZURE_AI_AGENT_ID="asst_OtwmJTEeIjau1YUZL10peovx"
export AZURE_AI_PROJECT_ENDPOINT="https://sentali-openai-project-resource.services.ai.azure.com/api/projects/sentali-openai-project"
export AZURE_AI_PROJECT_KEY="7WjDfju9MXRco6asOOljc12qXhnlQETiTB2RzG5nA3pq2qUsbujiJQQJ99BIACHYHv6XJ3w3AAAAACOGCFlY"
export AZURE_OPENAI_ENDPOINT="https://eastus.api.cognitive.microsoft.com/"
export AZURE_OPENAI_DEPLOYMENT="sentali-base"
export AZURE_TTS_KEY="F2fOeM0XIR7pV0FHLHpk3UKi6TYmWgCpVt2l9DVp7zlL4xUGqFtNJQQJ99BIACHYHv6XJ3w3AAAAACOGCFlY"
export AZURE_TTS_REGION="eastus"
export BASE_URL="https://sentali-app-6926.azurewebsites.net"

echo "Environment variables set:"
echo "AZURE_AI_AGENT_ID: $AZURE_AI_AGENT_ID"
echo "AZURE_AI_PROJECT_ENDPOINT: $AZURE_AI_PROJECT_ENDPOINT"
echo "AZURE_AI_PROJECT_KEY: [SET]"
echo "AZURE_OPENAI_ENDPOINT: $AZURE_OPENAI_ENDPOINT"
echo "AZURE_OPENAI_DEPLOYMENT: $AZURE_OPENAI_DEPLOYMENT"
echo "AZURE_TTS_REGION: $AZURE_TTS_REGION"
echo "BASE_URL: $BASE_URL"
echo ""

cd /home/runner/work/Sentali/Sentali/backend

echo "Building the application..."
dotnet build --configuration Release

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo ""
    echo "Starting the application on port 8080..."
    echo "You can test the API endpoints:"
    echo "  - Health check: http://localhost:8080/health"
    echo "  - GPT API: POST http://localhost:8080/api/tts with JSON body containing text"
    echo ""
    echo "Press Ctrl+C to stop the application"
    echo ""
    
    # Start the application
    dotnet run --configuration Release
else
    echo "❌ Build failed!"
    exit 1
fi