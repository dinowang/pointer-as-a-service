using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

namespace Hexdigits.Azure.PointerAsAService.Hubs
{
    public class RemoteHub : Hub
    {
        public async Task JoinGroup(string token)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, token);

            await Clients.Group(token).SendAsync("PresenterJoined");
        }

        public async Task LeaveGroup(string token)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, token);
        }

        public async Task UpdateStatus(string token, string docPath)
        {
            var data = new 
            {
                docPath = docPath,
                docName = Path.GetFileName(docPath)
            };

            await Clients.Group(token).SendAsync("UpdateStatus", data);
        }

        public async Task First(string token)
        {
            await Clients.Group(token).SendAsync("First");
        }

        public async Task Prev(string token)
        {
            await Clients.Group(token).SendAsync("Prev");
        }

        public async Task Next(string token)
        {
            await Clients.Group(token).SendAsync("Next");
        }
    }
}