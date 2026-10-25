using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Common.Framework.Deployment;

public static class ServerFolderBrowser
{
    public static List<(string Name, string Path)> GetRoots(string applicationDirectory)
    {
        var roots = new List<(string Name, string Path)>();
        try
        {
            foreach (var profile in OperatingSystem.IsWindows()
                ? Directory.EnumerateDirectories(@"C:\Users") : new[] { applicationDirectory })
            {
                var user = Path.GetFileName(profile);
                if (user is "Public" or "Default" or "Default User" or "All Users") continue;
                foreach (var sub in new[] { "Downloads", "Documents", "Desktop" })
                {
                    var candidate = Path.Combine(profile, sub);
                    if (Directory.Exists(candidate)) roots.Add(($"{sub} ({user})", candidate));
                }
            }
        }
        catch { /* Profile listing is best-effort. */ }
        roots.AddRange(DriveInfo.GetDrives().Where(d => d.IsReady).Select(d => (d.Name, d.Name)));
        return roots;
    }
}
