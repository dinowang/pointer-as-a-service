using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using QRCoder;

namespace Hexdigits.Azure.PointerAsAService.Services
{
    public class QrCodeService
    {
        public QRCode Generate(string content)
        {
            var generator = new QRCodeGenerator();
            var qrCodeData = generator.CreateQrCode(content, QRCodeGenerator.ECCLevel.Q);

            return new QRCode(qrCodeData);
        }

        public Bitmap GenerateBitmap(string content, int pixelsPerModule = 4)
        {
            var qrCode = Generate(content);

            return qrCode.GetGraphic(pixelsPerModule);
        }

        public string GenerateBase64(string content)
        {
            using (var bitmap = GenerateBitmap(content, 4))
            using (var stream = new MemoryStream())
            {
                bitmap.Save(stream, ImageFormat.Jpeg);

                return "data:image/jpeg;base64," + Convert.ToBase64String(stream.ToArray());
            }
        }
    }
}