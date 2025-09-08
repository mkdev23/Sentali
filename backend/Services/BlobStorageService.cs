using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using Azure.Identity;

namespace SentaliApp.Services;

public class BlobStorageService
{
    private readonly BlobContainerClient _container;

    public BlobStorageService(IConfiguration config, DefaultAzureCredential cred)
    {
        var uri = new Uri($"https://{config["STORAGE_ACCOUNT_NAME"]}.blob.core.windows.net/{config["STORAGE_CONTAINER_NAME"]}");
        _container = new BlobContainerClient(uri, cred);
    }

    public async Task<string> UploadAndGetSas(byte[] data)
    {
        var blobName = $"{Guid.NewGuid()}.mp3";
        var blob = _container.GetBlobClient(blobName);
        using var ms = new MemoryStream(data);
        await blob.UploadAsync(ms, overwrite: true);
        return blob.GenerateSasUri(BlobSasPermissions.Read, DateTimeOffset.UtcNow.AddMinutes(5)).ToString();
    }
}