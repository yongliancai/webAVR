 // Firebase初始化設定
 var firebaseConfig = {
  // 將你的Firebase設定填寫在這裡
  apiKey: "AIzaSyC4NzV-q4dBn_IytInpXlbbhEPaHJU9ULk",
  authDomain: "webavr-b9273.firebaseapp.com",
  projectId: "webavr-b9273",
  storageBucket: "webavr-b9273.appspot.com",
  messagingSenderId: "240463881336",
  appId: "1:240463881336:web:6642598bf894378f2ff98d",
  measurementId: "G-6Q7ZQ22WJN"
};
// 初始化Firebase
firebase.initializeApp(firebaseConfig);

// 監聽使用者登入狀態變化
firebase.auth().onAuthStateChanged(function(user) {
  if (user) {
      // 使用者已登入
      var currentUser = user;
      console.log("使用者已登入");
      // 獲取使用者資訊
      var db = firebase.firestore();
      var usersRef = db.collection("users");
      var chatMessagesRef = db.collection("chatMessages");

      // 加載好友列表
      loadFriendList(currentUser, usersRef, chatMessagesRef);

      // 監聽好友列表的點擊事件
      document.getElementById("friendList").addEventListener("click", function(event) {
          var friendId = event.target.getAttribute("data-friend-id");
          var friendName = event.target.innerText;

          // 更新聊天區域的內容
          updateChatArea(friendId, friendName, chatMessagesRef);
      });

      // 實現發送訊息功能
      document.getElementById("chatInputContainer").addEventListener("submit", function(event) {
          event.preventDefault();
          var message = document.getElementById("chatInput").value;

          // 建立訊息物件
          var newMessage = {
              senderId: currentUser.uid,
              senderName: currentUser.displayName,
              recipientId: currentFriendId,
              recipientName: currentFriendName,
              message: message,
              timestamp: firebase.firestore.FieldValue.serverTimestamp()
          };

          // 儲存訊息到Firestore
          chatMessagesRef.add(newMessage)
              .then(function(docRef) {
                  // 訊息儲存成功
                  document.getElementById("chatInput").value = "";
              })
              .catch(function(error) {
                  // 訊息儲存失敗
                  console.error("Error sending message: ", error);
              });
      });
  } else {
      // 使用者未登入，重導向到登入頁面
      window.location.href = "login.html";
  }
});

    // 加載好友列表
    function loadFriendList(currentUser, usersRef, chatMessagesRef) {
    var friendListRef = usersRef.doc(currentUser.uid);

    // 監聽好友列表的變化
    friendListRef.onSnapshot(function(doc) {
        var friendList = doc.data().friends || [];

        // 检查好友列表是否为空
        if (friendList.length === 0) {
        console.log("好友列表为空");
        }

        // 清空好友列表
        var friendListContainer = document.getElementById("friendList");
        friendListContainer.innerHTML = "";

        // 重新填充好友列表
        friendList.forEach(function(friendId) {
        usersRef.doc(friendId).get().then(function(friendDoc) {
            var friendData = friendDoc.data();
            var listItem = document.createElement("li");
            listItem.textContent = friendData.displayName;
            listItem.setAttribute("data-friend-id", friendId);
            listItem.addEventListener("click", function(event) {
            var friendId = event.target.getAttribute("data-friend-id");
            var friendName = event.target.innerText;

            // 更新聊天區域的內容
            updateChatArea(friendId, friendName, chatMessagesRef);
            });
            friendListContainer.appendChild(listItem);
        });
        });
    });
    }


// 更新聊天區域的內容
var currentFriendId = "";
var currentFriendName = "";

function updateChatArea(friendId, friendName, chatMessagesRef) {
  currentFriendId = friendId;
  currentFriendName = friendName;
  document.getElementById("chatUserName").innerText = friendName;

  // 監聽聊天訊息的變化
  chatMessagesRef.where("senderId", "in", [firebase.auth().currentUser.uid, friendId])
      .where("recipientId", "in", [firebase.auth().currentUser.uid, friendId])
      .orderBy("timestamp")
      .onSnapshot(function(snapshot) {
          var chatMessagesContainer = document.getElementById("chatMessages");
          chatMessagesContainer.innerHTML = "";

          snapshot.forEach(function(doc) {
              var messageData = doc.data();
              var message = document.createElement("div");
              message.className = "message";

              if (messageData.senderId === firebase.auth().currentUser.uid) {
                  message.classList.add("sent");
              } else {
                  message.classList.add("received");
              }

              var messageText = document.createElement("p");
              messageText.textContent = messageData.message;

              message.appendChild(messageText);
              chatMessagesContainer.appendChild(message);
          });

          // 滾動到最新訊息
          chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
      });
}

// 顯示聊天區域並更新內容
function showChat() {
  document.getElementById("chatContainer").style.display = "block";
  updateChatArea(currentFriendId, currentFriendName, chatMessagesRef);
}

// 傳送訊息
function sendMessage() {
  var message = document.getElementById("chatInput").value;

  // ...

  // 儲存訊息到Firestore
  chatMessagesRef.add(newMessage)
      .then(function(docRef) {
          // 訊息儲存成功
          document.getElementById("chatInput").value = "";
      })
      .catch(function(error) {
          // 訊息儲存失敗
          console.error("Error sending message: ", error);
      });
}

// 加入好友
function addFriend() {
    var friendNameOrId = document.getElementById('friendNameInput').value;
  
    // 根據好友的名稱或 ID 查找相應的使用者
    var usersRef = firebase.firestore().collection("users");
    usersRef.where("displayName", "==", friendNameOrId).get()
      .then(function(querySnapshot) {
        if (querySnapshot.empty) {
          console.log("找不到該好友");
          return;
        }
  
        var friendUser = querySnapshot.docs[0].data();
  
        // 取得目前使用者的好友列表
        var currentUser = firebase.auth().currentUser;
        var currentUserName = currentUser.displayName;
        var currentUserRef = firebase.database().ref(currentUserName + "/friends");
        currentUserRef.once("value")
          .then(function(snapshot) {
            var currentFriendList = snapshot.val();
            if (currentFriendList === null || typeof currentFriendList === 'undefined') {
              currentFriendList = {};
            }

  
            // 檢查好友是否已存在
            if (friendUser.uid in currentFriendList) {
              console.log("該好友已存在於你的好友列表中");
              return;
            }
  
            // 將好友加入目前使用者的好友列表
            currentFriendList[friendUser.uid] = "";
            currentUserRef.update(currentFriendList)
            .then(function() {
              console.log("成功加入好友");
  
              // 如果需要同时更新 Firestore 中的好友列表，添加以下代码：
               var currentUserUid = currentUser.uid;
               var currentUserFirestoreRef = usersRef.doc(currentUserUid);
               currentUserFirestoreRef.update({ friends: Object.keys(currentFriendList) });
            })
            .catch(function(error) {
              console.error("加入好友失敗：", error);
            });
          })
          .catch(function(error) {
            console.error("獲取目前使用者資料失敗：", error);
          });
      })
      .catch(function(error) {
        console.error("查找使用者失敗：", error);
      });
  }
  
  