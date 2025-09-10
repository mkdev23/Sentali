using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using Azure.Identity;
using Azure.Storage.Blobs.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace SentaliApp.Services
{
    public class BlobStorageService
    {
        private readonly BlobContainerClient _container;
        private readonly ILogger<BlobStorageService> _logger;

        public BlobStorageService(IConfiguration config, DefaultAzureCredential cred, ILogger<BlobStorageService> logger)
        {
            _logger = logger;

            var endpointRaw = config["BLOB_STORAGE_ENDPOINT"]?.Trim()
                ?? throw new InvalidOperationException("BLOB_STORAGE_ENDPOINT is missing");

            var containerName = config["BLOB_CONTAINER_NAME"]?.Trim()
                ?? throw new InvalidOperationException("BLOB_CONTAINER_NAME is missing");

            if (!Uri.TryCreate(endpointRaw, UriKind.Absolute, out var endpointUri))
                throw new InvalidOperationException($"Invalid BLOB_STORAGE_ENDPOINT: '{endpointRaw}'");

            var baseUri = endpointUri.AbsoluteUri.TrimEnd('/');
            if (baseUri.EndsWith($"/{containerName}", StringComparison.OrdinalIgnoreCase))
                _container = new BlobContainerClient(endpointUri, cred);
            else
                _container = new BlobContainerClient(new Uri($"{baseUri}/{containerName}"), cred);
        }

        public async Task<string> UploadAndGetSas(byte[] data)
        {
            var blobName = $"{Guid.NewGuid()}.mp3";
            var blob = _container.GetBlobClient(blobName);

            using var ms = new MemoryStream(data);
            var headers = new BlobHttpHeaders { ContentType = "audio/mpeg" };
            await blob.UploadAsync(ms, new BlobUploadOptions { HttpHeaders = headers });

            if (!blob.CanGenerateSasUri)
                throw new InvalidOperationException("Blob client cannot generate SAS URI. Check credentials/roles.");

            var sasExpiry = DateTimeOffset.UtcNow.AddMinutes(5);
            var sasUri = blob.GenerateSasUri(BlobSasPermissions.Read, sasExpiry);

            _logger.LogInformation("[BlobStorage] Uploaded {BlobName}, SAS expires at {Expiry}", blobName, sasExpiry);

            return sasUri.ToString();
        }
    }
}
