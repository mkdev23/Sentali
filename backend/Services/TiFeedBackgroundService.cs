using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Mvc; // For OkObjectResult, ObjectResult
using System.Text.Json; // For JsonElement
using SentaliApp.Controllers; // For TiFeedData, TiIoc, TiIocIndicator

namespace SentaliApp.Services
{
    public class TiFeedBackgroundService : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<TiFeedBackgroundService> _logger;
        private readonly TimeSpan _updateInterval = TimeSpan.FromHours(48); // Every 48 hours

        public TiFeedBackgroundService(IServiceProvider serviceProvider, ILogger<TiFeedBackgroundService> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("TI Feed Background Service started at {Time}", DateTimeOffset.Now);

            // Initial update on startup (with delay to avoid startup congestion)
            await UpdateTiFeed();
            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
            

            // Schedule recurring updates
            using var timer = new PeriodicTimer(_updateInterval);
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await timer.WaitForNextTickAsync(stoppingToken);
                    await UpdateTiFeed();
                }
                catch (OperationCanceledException)
                {
                    // Expected when stopping
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Unexpected error in TI feed timer");
                }
            }

            _logger.LogInformation("TI Feed Background Service stopped");
        }

        private async Task UpdateTiFeed()
        {
            _logger.LogInformation("Starting scheduled TI feed update at {Time}", DateTimeOffset.Now);

            try
            {
                using var scope = _serviceProvider.CreateScope();
                var anyRunController = scope.ServiceProvider.GetRequiredService<AnyRunController>();

                // Call the public refresh method
                var refreshResponse = await anyRunController.RefreshTiFeed();
                
                if (refreshResponse is OkObjectResult okResult)
                {
                    var result = okResult.Value;
                    if (result != null)
                    {
                        // Parse the response to get the count
                        if (result is JsonElement resultElement)
                        {
                            if (resultElement.TryGetProperty("message", out var messageProp))
                            {
                                var message = messageProp.GetString();
                                // Extract count from message like "TI feed updated successfully: 1234 IOCs"
                                if (message != null && message.Contains("IOCs"))
                                {
                                    var countMatch = System.Text.RegularExpressions.Regex.Match(message, @"(\d+) IOCs");
                                    if (countMatch.Success)
                                    {
                                        if (int.TryParse(countMatch.Groups[1].Value, out var count))
                                        {
                                            _logger.LogInformation("Background TI feed update completed: {Count} IOCs saved", count);
                                        }
                                        else
                                        {
                                            _logger.LogInformation("Background TI feed update completed: {Message}", message);
                                        }
                                    }
                                    else
                                    {
                                        _logger.LogInformation("Background TI feed update completed: {Message}", message);
                                    }
                                }
                                else
                                {
                                    _logger.LogInformation("Background TI feed update completed successfully");
                                }
                            }
                        }
                        else
                        {
                            _logger.LogInformation("Background TI feed update completed successfully");
                        }
                    }
                    else
                    {
                        _logger.LogInformation("Background TI feed update completed successfully");
                    }
                }
                else if (refreshResponse is ObjectResult errorResult && errorResult.StatusCode >= 400)
                {
                    var error = errorResult.Value;
                    if (error != null)
                    {
                        _logger.LogWarning("Background TI feed update failed: {StatusCode} - {Error}", 
                            errorResult.StatusCode, error.ToString());
                    }
                    else
                    {
                        _logger.LogWarning("Background TI feed update failed with status code: {StatusCode}", errorResult.StatusCode);
                    }
                }
                else
                {
                    _logger.LogWarning("Background TI feed update returned unexpected response type: {Type}", 
                        refreshResponse?.GetType().Name ?? "null");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during background TI feed update at {Time}", DateTimeOffset.Now);
            }
        }
    }
}