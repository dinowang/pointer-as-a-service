using System;
using Microsoft.AspNetCore.Mvc;

namespace Hexdigits.Azure.PointerAsAService
{
    public static class UrlHelperExtensions
    {
       public static string AbsoluteContent(this IUrlHelper urlHelper, string contentPath)
       {
           var request = urlHelper.ActionContext.HttpContext.Request;

           return new Uri(new Uri(request.Scheme + "://" + request.Host.Value), urlHelper.Content(contentPath)).ToString();
       } 
    }
}