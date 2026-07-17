namespace BankStatementAnalytics.Services.Pdf
{
    /// <summary>
    /// Base type for all PDF statement extraction failures. Messages are
    /// user-facing: the upload endpoint returns them verbatim as 400 responses.
    /// </summary>
    public class PdfExtractionException : Exception
    {
        public PdfExtractionException(string message) : base(message) { }
        public PdfExtractionException(string message, Exception inner) : base(message, inner) { }
    }

    /// <summary>The PDF is encrypted and no password was supplied.</summary>
    public class PdfPasswordRequiredException : PdfExtractionException
    {
        public PdfPasswordRequiredException()
            : base("This PDF is password-protected. Enter the PDF password and try again.") { }
    }

    /// <summary>The PDF is encrypted and the supplied password did not open it.</summary>
    public class PdfWrongPasswordException : PdfExtractionException
    {
        public PdfWrongPasswordException()
            : base("Incorrect PDF password. Check the password (usually described in the bank's statement email) and try again.") { }
    }

    /// <summary>The PDF opened but contains no extractable text (scanned image).</summary>
    public class PdfNoTextLayerException : PdfExtractionException
    {
        public PdfNoTextLayerException()
            : base("This PDF appears to be a scanned image with no selectable text. " +
                   "Please upload the e-statement PDF downloaded from netbanking or emailed by the bank instead.") { }
    }

    /// <summary>No transaction-table header matching the bank's profile was found.</summary>
    public class PdfTableNotFoundException : PdfExtractionException
    {
        public PdfTableNotFoundException(string detail)
            : base("Could not find the transaction table in this PDF — the layout may not be supported yet. " + detail) { }
    }
}
