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

        private static Common.Framework.Deployment.RootedFileStore Store =>
            new(Root, "Invalid stored statement path.");

        public static void DeleteFile(string storedName) => Store.DeleteFile(storedName);
        public static string ResolvePath(string storedName) => Store.ResolvePath(storedName);
    }
}