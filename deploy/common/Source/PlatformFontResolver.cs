using System;
using System.IO;
using PdfSharp.Fonts;

namespace Common.Framework.Deployment;

// Optional PDFsharp module. Register once through GlobalFontSettings.FontResolver.
public sealed class PlatformFontResolver : IFontResolver
{
    private readonly string _directory;
    public PlatformFontResolver(string? directory = null) => _directory = directory ??
        (OperatingSystem.IsWindows()
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Fonts")
            : "/usr/share/fonts/truetype/dejavu");

    public byte[]? GetFont(string faceName) => File.ReadAllBytes(Path.Combine(_directory, faceName));

    public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic)
    {
        var name = OperatingSystem.IsWindows()
            ? (bold, italic) switch
            {
                (true, true) => "segoeuiz.ttf", (true, false) => "segoeuib.ttf",
                (false, true) => "segoeuii.ttf", _ => "segoeui.ttf"
            }
            : (bold, italic) switch
            {
                (true, true) => "DejaVuSans-BoldOblique.ttf", (true, false) => "DejaVuSans-Bold.ttf",
                (false, true) => "DejaVuSans-Oblique.ttf", _ => "DejaVuSans.ttf"
            };
        return new FontResolverInfo(name);
    }
}
