(function () {
    "use strict";

    var token = $("input#token").val();
    var connection = new signalR
                            .HubConnectionBuilder()
                            .withUrl("/remoteHub")
                            .configureLogging(signalR.LogLevel.Information)
                            .build();

    var connect = function () {
        $(".status").text("Connecting...");
        connection
            .start()
            .then(_ => {
                $(".status").text("Connected");
                $("#cmds").show();
                connection.invoke("JoinGroup", token).catch(function (err) {
                    return console.error(err.toString());
                });
            })
            .catch(err => {
                $(".status").text("Reconnect...");
                setTimeout(connect, 1000);
                return console.error(err.toString());
            });
    };

    connect();
    
    connection
        .onclose(_ => {
            $(".status").text("Disconnected");
            setTimeout(connect, 1000);
        });
    
    connection.on("UpdateStatus", data => {
        var docName = data.docName || "(noname)";
        $(".navbar-brand").text(docName);
        document.title = docName;
    });
    
    $("body")
        .on("click", ".simple-ctrl", function (evt) {
            var $this = $(this),
                cmd = $this.data("cmd");

            connection.invoke(cmd, token).catch(function (err) {
                return console.error(err.toString());
            });

            return false;
        });
        
})();