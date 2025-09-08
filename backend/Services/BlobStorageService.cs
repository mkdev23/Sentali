using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using Azure.Identity;

namespace SentaliApp.Services;

public class BlobStorageService
{
    private readonly BlobContainerClient? _container;

    public BlobStorageService(IConfiguration config, DefaultAzureCredential cred)
    {
        var storageAccountName = config["STORAGE_ACCOUNT_NAME"];
        var storageContainerName = config["STORAGE_CONTAINER_NAME"];
        
        if (!string.IsNullOrEmpty(storageAccountName) && !string.IsNullOrEmpty(storageContainerName))
        {
            var uri = new Uri($"https://{storageAccountName}.blob.core.windows.net/{storageContainerName}");
            _container = new BlobContainerClient(uri, cred);
            Console.WriteLine("[Blob] Storage container configured");
        }
        else
        {
            Console.WriteLine("[Blob] Warning: STORAGE_ACCOUNT_NAME or STORAGE_CONTAINER_NAME not configured. File upload will be disabled");
            _container = null;
        }
    }

    public async Task<string> UploadAndGetSas(byte[] data)
    {
        if (_container == null)
        {
            Console.WriteLine("[Blob] Storage not configured, returning placeholder URL");
            return "data:audio/mp3;base64," + Convert.ToBase64String(data);
        }
        
        try
        {
            var blobName = $"{Guid.NewGuid()}.mp3";
            var blob = _container.GetBlobClient(blobName);
            using var ms = new MemoryStream(data);
            await blob.UploadAsync(ms, overwrite: true);
            return blob.GenerateSasUri(BlobSasPermissions.Read, DateTimeOffset.UtcNow.AddMinutes(5)).ToString();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Blob] Error uploading to storage: {ex.Message}");
            return "data:audio/mp3;base64," + Convert.ToBase64String(data);
        }
    }
}