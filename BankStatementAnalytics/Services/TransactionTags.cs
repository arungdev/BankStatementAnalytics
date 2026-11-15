namespace BankStatementAnalytics.Services;

public static class TransactionTags
{
    // Commas are the persisted delimiter. Keep first-occurrence order and spelling
    // for rules; manual transaction edits retain their existing lowercase contract.
    public static string? Normalize(IEnumerable<string?>? tags, bool lowercase = false)
    {
        var normalized = tags?
            .Where(tag => !string.IsNullOrWhiteSpace(tag))
            .SelectMany(tag => tag!.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Select(tag => lowercase ? tag.ToLowerInvariant() : tag)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        return normalized is { Length: > 0 } ? string.Join(",", normalized) : null;
    }

    public static string Merge(string? existing, string? added) =>
        Normalize(new[] { existing, added }) ?? string.Empty;
}
