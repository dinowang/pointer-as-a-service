(function () {
    "use strict";

    var token = $("input#token").val();
    var connection = new signalR
                            .HubConnectionBuilder()
                            .withUrl("/remoteHub")
                            .configureLogging(signalR.LogLevel.Information)
                            .build();

    function connect() {
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
    
    $(document).ready(function () {
        var manager = nipplejs.create({
            zone: document.getElementById('touchpad'),
            mode: 'dynamic',
            position: { left: '50%', top: '50%' },
            color: 'red'
        });

        var dir = null;

        manager
            .on("move", function (evt, nipple) {
                dir = nipple.direction;
            })
            .on("end", function (evt, nipple) {
                switch (dir.angle) {
                    case "right":
                        connection.invoke("Next", token).catch(function (err) {
                            return console.error(err.toString());
                        });
                        break;
                    case "left":
                        connection.invoke("Prev", token).catch(function (err) {
                            return console.error(err.toString());
                        });
                    break;
                }
            });
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