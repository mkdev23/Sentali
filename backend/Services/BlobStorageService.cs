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

        public BlobStorageService(BlobServiceClient serviceClient, IConfiguration config, ILogger<BlobStorageService> logger)
        {
            _logger = logger;
            _serviceClient = serviceClient ?? throw new ArgumentNullException(nameof(serviceClient));

            var containerName = config["BLOB_CONTAINER_NAME"]?.Trim()
                ?? Environment.GetEnvironmentVariable("BLOB_CONTAINER_NAME")
                ?? "tts-cache"; // Fallback to a default if missing

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