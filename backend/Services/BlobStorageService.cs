using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using Azure.Identity;

namespace SentaliApp.Services
{
    public class BlobStorageService
    {
        private readonly BlobContainerClient _container;

        public BlobStorageService(IConfiguration config, DefaultAzureCredential cred)
        {
            var endpointRaw = config["BLOB_STORAGE_ENDPOINT"]?.Trim()
                ?? throw new InvalidOperationException("BLOB_STORAGE_ENDPOINT is missing");

            var containerName = config["BLOB_CONTAINER_NAME"]?.Trim()
                ?? throw new InvalidOperationException("BLOB_CONTAINER_NAME is missing");

            if (!Uri.TryCreate(endpointRaw, UriKind.Absolute, out var endpointUri))
                throw new InvalidOperationException($"Invalid BLOB_STORAGE_ENDPOINT: '{endpointRaw}'");

            // Build the container URI directly
            var containerUri = new Uri($"{endpointUri}{containerName}");

            _container = new BlobContainerClient(containerUri, cred);
        }

        public async Task<string> UploadAndGetSas(byte[] data)
        {
            var blobName = $"{Guid.NewGuid()}.mp3";
            var blob = _container.GetBlobClient(blobName);

            using var ms = new MemoryStream(data);
            await blob.UploadAsync(ms, overwrite: true);

            return blob.GenerateSasUri(
                BlobSasPermissions.Read,
                DateTimeOffset.UtcNow.AddMinutes(5)
            ).ToString();
        }
    }
}