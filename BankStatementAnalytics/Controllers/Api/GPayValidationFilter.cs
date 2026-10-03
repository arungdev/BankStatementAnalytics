using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
namespace BankStatementAnalytics.Controllers.Api;
public class GPayValidationFilter : IExceptionFilter
{
    public void OnException(ExceptionContext context) {
        if(context.Exception is ArgumentException or FormatException or System.IO.InvalidDataException) {
            context.Result=new BadRequestObjectResult(new {message=context.Exception.Message});
            context.ExceptionHandled=true;
        }
    }
}
