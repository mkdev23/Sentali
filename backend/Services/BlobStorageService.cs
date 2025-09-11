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
        private readonly BlobServiceClient _serviceClient;
        private readonly ILogger<BlobStorageService> _logger;

        public BlobStorageService(IConfiguration config, ILogger<BlobStorageService> logger)
        {
            _logger = logger;

            var endpointRaw = config["BLOB_STORAGE_ENDPOINT"]?.Trim()
                ?? throw new InvalidOperationException("BLOB_STORAGE_ENDPOINT is missing");

            var containerName = config["BLOB_CONTAINER_NAME"]?.Trim()
                ?? throw new InvalidOperationException("BLOB_CONTAINER_NAME is missing");

            if (!Uri.TryCreate(endpointRaw, UriKind.Absolute, out var endpointUri))
                throw new InvalidOperationException($"Invalid BLOB_STORAGE_ENDPOINT: '{endpointRaw}'");

            // Create service + container clients using Managed Identity
            _serviceClient = new BlobServiceClient(endpointUri, new DefaultAzureCredential());
            _container = _serviceClient.GetBlobContainerClient(containerName);
        }

        public async Task<string> UploadAndGetSas(byte[] data)
        {
            var blobName = $"{Guid.NewGuid()}.mp3";
            var blob = _container.GetBlobClient(blobName);

            using var ms = new MemoryStream(data);
            var headers = new BlobHttpHeaders { ContentType = "audio/mpeg" };
            await blob.UploadAsync(ms, new BlobUploadOptions { HttpHeaders = headers });

            // Generate a User Delegation SAS (works with Managed Identity)
            var sasExpiry = DateTimeOffset.UtcNow.AddMinutes(5);
            var delegationKey = await _serviceClient.GetUserDelegationKeyAsync(DateTimeOffset.UtcNow, sasExpiry);

            var sasBuilder = new BlobSasBuilder
            {
                BlobContainerName = _container.Name,
                BlobName = blobName,
                Resource = "b", // blob
                StartsOn = DateTimeOffset.UtcNow.AddMinutes(-1),
                ExpiresOn = sasExpiry
            };

            sasBuilder.SetPermissions(BlobSasPermissions.Read);

            // Build SAS token from the builder + user delegation key
            var accountName = _serviceClient.AccountName;
            var sasToken = sasBuilder.ToSasQueryParameters(delegationKey, accountName).ToString();

            // Append SAS token to blob URI
            var sasUri = new Uri($"{blob.Uri}?{sasToken}");

            _logger.LogInformation("[BlobStorage] Uploaded {BlobName}, SAS expires at {Expiry}", blobName, sasExpiry);

            return sasUri.ToString();
        }
    }
}
