using System;
using System.IO;
using System.Linq;

namespace Common.Framework.Deployment;

// Relative paths only. The application owns the root and must not allow untrusted symlinks.
public sealed class RootedFileStore
{
    private readonly string _root;
    private readonly string _message;
    private readonly StringComparison _comparison = OperatingSystem.IsWindows()
        ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    public RootedFileStore(string root, string invalidPathMessage = "Invalid stored file path.")
    {
        _root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        _message = invalidPathMessage;
    }

    public string ResolvePath(string storedName)
    {
        var prefix = Path.EndsInDirectorySeparator(_root) ? _root : _root + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.Combine(prefix, storedName));
        if (Path.IsPathRooted(storedName) || !path.StartsWith(prefix, _comparison))
            throw new ArgumentException(_message, nameof(storedName));
        return path;
    }

    public void DeleteFile(string storedName)
    {
        if (string.IsNullOrEmpty(storedName)) return;
        var path = ResolvePath(storedName);
        if (File.Exists(path)) File.Delete(path);
        var directory = Path.GetDirectoryName(path);
        if (directory != null && !string.Equals(directory, _root, _comparison)
            && Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any())
            Directory.Delete(directory);
    }
}
