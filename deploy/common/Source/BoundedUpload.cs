namespace Common.Framework.Deployment;

public static class BoundedUpload
{
    public static async Task<byte[]> ReadAsync(Stream source, long maximum, CancellationToken cancellationToken = default)
    {
        using var result = new MemoryStream();
        var buffer = new byte[81920];
        int count;
        while ((count = await source.ReadAsync(buffer, cancellationToken)) != 0)
        {
            if (result.Length + count > maximum) throw new ArgumentException("Upload exceeds the supported size limit.");
            await result.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
        }
        return result.ToArray();
    }
}
