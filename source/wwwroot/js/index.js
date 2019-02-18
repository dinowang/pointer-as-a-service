(function () {
    "use strict";
    
    var token = $("input#token").val();
    var connection = new signalR
                            .HubConnectionBuilder()
                            .withUrl("/remoteHub")
                            .configureLogging(signalR.LogLevel.Information)
                            .build();

    var updateStatus = function () {
        if (Office.context && Office.context.document) {
            var url = Office.context.document.url;
            connection.invoke("UpdateStatus", token, url).catch(function (err) {
                return console.error(err.toString());
            });
        }
    };

    var connect = function () {
        $(".status").text("Connecting...");
        connection
            .start()
            .then(_ => {
                $(".status").text("Connected");
                connection.invoke("JoinGroup", token).catch(function (err) {
                    return console.error(err.toString());
                });
                updateStatus();
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

    Office.onReady(reason => {

        connection.on("UpdateStatus", data => {
            var docName = data.docName || "(noname)";
            $(".navbar-brand").text(docName);
        });
    
        connection.on("PresenterJoined", _ => {
            updateStatus();
        });

        connection.on("First", _ => {
            Office.context.document.goToByIdAsync(Office.Index.First, Office.GoToType.Index, result => {});
        });
    
        connection.on("Prev", _ => {
            Office.context.document.goToByIdAsync(Office.Index.Previous, Office.GoToType.Index, result => {});
        });
    
        connection.on("Next", _ => {
            Office.context.document.goToByIdAsync(Office.Index.Next, Office.GoToType.Index, result => {});
        });
    });

    $(document).ready(_ => {
        var url = $(".control").attr("href");
        $('#qrcode').empty().qrcode({ width: 180, height: 180, text: url });
    });

    $("body")
        .on("click", "a.refresh", _ => {
            connection.invoke("LeaveGroup", token).catch(function (err) {
                return console.error(err.toString());
            });

            $.get("/refresh", (data, status, xhr) => {
                token = data.id;
                $("a.control").attr("href", data.url).attr("title", data.url);
                $('#qrcode').empty().qrcode({ width: 180, height: 180, text: data.url });
                $("#token").val("src", data.id);

                connection.invoke("JoinGroup", token).catch(function (err) {
                    return console.error(err.toString());
                });
            });
            
            return false;
        })
        .on("click", "a.theme", _ => {
            var $body = $("body"),
                $nav = $("header nav"),
                $footer = $("footer"),
                theme = $body.is(".dark") ? "dark" : "white";

            switch (theme)
            {
                case "white":
                    $body.removeClass("white").addClass("dark bg-secondary");
                    $nav.removeClass("navbar-light bg-white border-bottom").addClass("navbar-dark bg-dark");
                    $footer.removeClass("border-top").addClass("bg-dark");
                    document.cookie = "theme=dark";
                    break;
                case "dark":
                    $body.removeClass("dark bg-secondary").addClass("white");
                    $nav.removeClass("navbar-dark bg-dark").addClass("navbar-light bg-white border-bottom");
                    $footer.removeClass("bg-dark").addClass("border-top");
                    document.cookie = "theme=white";
                    break;
            }
        });
})();