namespace BankStatementAnalytics.Services;

// Output is an allowlisted category, never a provider response, token or URL.
public static class GoogleLoginFailure
{
    public static string Classify(Exception? failure, string? providerError = null)
    {
        if (string.Equals(providerError, "access_denied", StringComparison.Ordinal)) return "cancelled";
        for (var depth = 0; failure != null && depth < 8; depth++, failure = failure.InnerException)
        {
            var message = failure.Message;
            if (message.Contains("invalid_client", StringComparison.OrdinalIgnoreCase)) return "credentials";
            if (message.Contains("invalid_grant", StringComparison.OrdinalIgnoreCase)) return "expired";
            if (message.Contains("correlation", StringComparison.OrdinalIgnoreCase)) return "correlation";
            if (message.Contains("state", StringComparison.OrdinalIgnoreCase) &&
                (message.Contains("invalid", StringComparison.OrdinalIgnoreCase) || message.Contains("missing", StringComparison.OrdinalIgnoreCase))) return "state";
            if (failure is HttpRequestException or TaskCanceledException) return "network";
        }
        return "failed";
    }
}
