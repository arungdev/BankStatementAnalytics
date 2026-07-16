using BankStatementAnalytics.Models;

namespace BankStatementAnalytics.Services
{
    // Uploads are stored per account under Uploads/<Bank> - <AccountNumber>/.
    // StoredName holds the path relative to the Uploads root, so files written
    // before this layout existed (flat GUID names) still resolve.
    public static class UploadStorage
    {
        public static string Root =>
            Path.Combine(Common.Framework.AppPaths.ResolveWritableAppDataDirectory(), "Uploads");

        public static string AccountFolderName(Account account)
        {
            var number = string.IsNullOrWhiteSpace(account.AccountNumber)
                ? $"account-{account.Id}"
                : account.AccountNumber.Trim();

            var name = $"{account.BankName} - {number}";
            foreach (var c in Path.GetInvalidFileNameChars())
                name = name.Replace(c, '_');
            return name;
        }

        public static void DeleteFile(string storedName)
        {
            if (string.IsNullOrEmpty(storedName))
                return;

            var filePath = Path.Combine(Root, storedName);
            if (File.Exists(filePath))
                File.Delete(filePath);

            // Drop the account folder once its last statement is gone.
            var dir = Path.GetDirectoryName(filePath);
            if (dir != null
                && !string.Equals(Path.GetFullPath(dir), Path.GetFullPath(Root), StringComparison.OrdinalIgnoreCase)
                && Directory.Exists(dir)
                && !Directory.EnumerateFileSystemEntries(dir).Any())
            {
                Directory.Delete(dir);
            }
        }
    }
}
