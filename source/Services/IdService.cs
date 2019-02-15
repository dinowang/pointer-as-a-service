using System;
using System.Text.RegularExpressions;

namespace Hexdigits.Azure.PointerAsAService.Services
{
    public class IdService
    {
        public string Generate() => Pack(Guid.NewGuid());

        public string Pack(Guid guid) => Regex.Replace(Convert.ToBase64String(guid.ToByteArray()), "==$", "").Replace("+", "-").Replace("/", "_");

        public Guid Parse(string id) => new Guid(Convert.FromBase64String(id.Replace("-", "+").Replace("_", "/") + "=="));
    }
}