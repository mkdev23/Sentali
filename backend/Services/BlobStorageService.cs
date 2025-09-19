using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using Azure.Identity;
using Azure.Storage.Blobs.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Text;
using System.Text.Json;

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

            _serviceClient = new BlobServiceClient(endpointUri, new DefaultAzureCredential());
            _container = _serviceClient.GetBlobContainerClient(containerName);
        }

        // Existing audio upload
        public async Task<string> UploadAndGetSas(byte[] data)
        {
            return await UploadAndGetSasInternal(data, $"{Guid.NewGuid()}.mp3", "audio/mpeg", TimeSpan.FromMinutes(5));
        }

        // New: Upload JSON (e.g., TI feed) and return SAS
        public async Task<string> UploadJsonAndGetSas<T>(T obj, string? namePrefix = null, TimeSpan? sasLifetime = null)
        {
            var json = JsonSerializer.Serialize(obj, new JsonSerializerOptions { WriteIndented = false });
            var blobName = $"{namePrefix ?? "ti-feed"}_{DateTime.UtcNow:yyyyMMdd_HHmmss}.json";
            return await UploadAndGetSasInternal(Encoding.UTF8.GetBytes(json), blobName, "application/json", sasLifetime ?? TimeSpan.FromHours(1));
        }

        private async Task<string> UploadAndGetSasInternal(byte[] data, string blobName, string contentType, TimeSpan sasLifetime)
        {
            var blob = _container.GetBlobClient(blobName);

            using var ms = new MemoryStream(data);
            var headers = new BlobHttpHeaders { ContentType = contentType };
            await blob.UploadAsync(ms, new BlobUploadOptions { HttpHeaders = headers });

            var sasExpiry = DateTimeOffset.UtcNow.Add(sasLifetime);
            var delegationKey = await _serviceClient.GetUserDelegationKeyAsync(DateTimeOffset.UtcNow, sasExpiry);

            var sasBuilder = new BlobSasBuilder
            {
                BlobContainerName = _container.Name,
                BlobName = blobName,
                Resource = "b",
                StartsOn = DateTimeOffset.UtcNow.AddMinutes(-1),
                ExpiresOn = sasExpiry
            };
            sasBuilder.SetPermissions(BlobSasPermissions.Read);

            var accountName = _serviceClient.AccountName;
            var sasToken = sasBuilder.ToSasQueryParameters(delegationKey, accountName).ToString();
            var sasUri = new Uri($"{blob.Uri}?{sasToken}");

            _logger.LogInformation("[BlobStorage] Uploaded {BlobName}, SAS expires at {Expiry}", blobName, sasExpiry);

            return sasUri.ToString();
        }
    }
}