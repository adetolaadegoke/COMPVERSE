import { createClient } from
"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ADD YOUR SUPABASE PUBLIC DETAILS LATER
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const $ = selector => document.querySelector(selector);

let currentUser = null;
let currentProfile = null;
let authMode = "signup";

function openModal(id) {
  $("#" + id).showModal();
}

function closeModal(id) {
  $("#" + id).close();
}

document.querySelectorAll("[data-close]").forEach(button => {
  button.onclick = () => closeModal(button.dataset.close);
});

$("#sign-in").onclick = () => openModal("auth-modal");
$("#join").onclick = () => openModal("auth-modal");
$("#empty-join").onclick = () => openModal("auth-modal");
$("#new-post").onclick = () => openModal("post-modal");
$("#mobile-create").onclick = () => openModal("post-modal");

$("#add-story").onclick = () => {
  alert("Story publishing will be connected to the media upload module.");
};

// SAFE HTML TEXT
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

// PAGE NAVIGATION
function setPage(page) {

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === page
    );
  });

  const pages = {

    home: [
      "Your universe.",
      "Discover what's happening across Nigerian private universities."
    ],

    discover: [
      "Discover.",
      "Find students, creators and campus conversations."
    ],

    stories: [
      "Campus stories.",
      "Moments shared by your student community."
    ],

    live: [
      "CAMPVERSE Live.",
      "Live broadcasts and creator rooms."
    ],

    messages: [
      "Your messages.",
      "Private conversations with other students."
    ],

    calls: [
      "Video calls.",
      "Connect face-to-face with friends."
    ],

    campuses: [
      "Universities.",
      "Explore Nigerian private universities."
    ],

    wallet: [
      "Wallet & gifts.",
      "Coins, gifts and creator earnings."
    ],

    profile: [
      "Your profile.",
      "Your CAMPVERSE identity."
    ]

  };

  const pageInfo = pages[page] || pages.home;

  $("#page-title").textContent = pageInfo[0];
  $("#page-subtitle").textContent = pageInfo[1];

  $("#page-content").innerHTML = "";

  if (page === "home") {
    loadFeed();
    return;
  }

  const descriptions = {
    discover: "Find and discover your campus community.",
    stories: "Share moments that disappear after 24 hours.",
    live: "Live video streaming and virtual gifts.",
    messages: "Private student-to-student messaging.",
    calls: "One-to-one video and voice conversations.",
    campuses: "Explore registered private universities.",
    wallet: "Manage coins, gifts and creator earnings.",
    profile: "View and manage your student profile."
  };

  $("#feed-list").innerHTML = `
    <div class="empty">
      <div class="empty-icon">✦</div>
      <h3>${esc(pageInfo[0])}</h3>
      <p>${esc(descriptions[page])}</p>
    </div>
  `;

  if (page === "campuses") {
    loadUniversities();
  }
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.onclick = () => setPage(button.dataset.page);
});

document.querySelectorAll("[data-open-page]").forEach(button => {
  button.onclick = () => setPage(button.dataset.openPage);
});

// LOAD UNIVERSITY DIRECTORY
async function loadUniversities() {

  const select = $("#university-select");
  const preview = $("#university-preview");

  try {

    const response = await fetch("/api/universities");
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error);
    }

    select.innerHTML =
      '<option value="">Select your university</option>' +
      result.universities.map(university => `
        <option value="${esc(university.id)}">
          ${esc(university.name)}
        </option>
      `).join("");

    preview.innerHTML =
      result.universities.slice(0, 5).map(university => `
        <div class="school">
          <span class="school-icon">🎓</span>
          <div>
            <b>${esc(university.name)}</b>
            <small>${esc(university.state || "")}</small>
          </div>
        </div>
      `).join("");

  } catch (error) {

    select.innerHTML =
      '<option value="">Database not connected</option>';

    preview.innerHTML =
      '<p class="muted">Connect your database to load universities.</p>';

  }
}

// SIGNUP AND LOGIN SWITCH
document.querySelectorAll("[data-auth-mode]").forEach(button => {

  button.onclick = () => {

    authMode = button.dataset.authMode;

    document.querySelectorAll("[data-auth-mode]").forEach(item => {
      item.classList.toggle("selected", item === button);
    });

    $("#auth-title").textContent =
      authMode === "signup"
        ? "Join your universe."
        : "Welcome back.";

    $("#name-field").hidden = authMode === "login";
    $("#school-field").hidden = authMode === "login";

    $("#auth-submit").textContent =
      authMode === "signup"
        ? "Create Account"
        : "Sign In";

  };

});

// REGISTRATION AND LOGIN
$("#auth-form").addEventListener("submit", async event => {

  event.preventDefault();

  const message = $("#auth-message");

  if (!supabase) {
    message.textContent =
      "Connect Supabase URL and public key inside app.js first.";
    return;
  }

  const form = new FormData(event.currentTarget);

  const email = String(form.get("email")).trim();
  const password = String(form.get("password"));

  message.textContent = "Please wait...";

  let result;

  if (authMode === "signup") {

    result = await supabase.auth.signUp({

      email,
      password,

      options: {
        data: {
          full_name: String(form.get("full_name")).trim(),
          university_id: String(form.get("university_id"))
        }
      }

    });

  } else {

    result = await supabase.auth.signInWithPassword({
      email,
      password
    });

  }

  if (result.error) {
    message.textContent = result.error.message;
    return;
  }

  if (authMode === "signup") {

    message.textContent =
      "Account created. Confirm your email before signing in.";

    return;

  }

  message.textContent = "Welcome to CAMPVERSE!";

  await refreshSession();

  setTimeout(() => closeModal("auth-modal"), 800);

});

// REFRESH LOGGED-IN USER
async function refreshSession() {

  if (!supabase) return;

  const { data } = await supabase.auth.getSession();

  currentUser = data.session?.user || null;

  if (!currentUser) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  currentProfile = profile;

  $("#side-name").textContent =
    profile?.full_name || currentUser.email;

  $("#sign-in").textContent = "Sign Out";

  $("#sign-in").onclick = async () => {
    await supabase.auth.signOut();
    location.reload();
  };

  if (profile?.verification_status !== "approved") {
    showVerificationPrompt();
  }

}

// STUDENT VERIFICATION
function showVerificationPrompt() {

  $("#feed-list").innerHTML = `
    <div class="empty">
      <div class="empty-icon">♙</div>
      <h3>Student verification required</h3>
      <p>Submit your admission letter to unlock your campus community.</p>
      <button class="gold" id="verify-open">
        Verify Student Account
      </button>
    </div>
  `;

  $("#verify-open").onclick = () => {
    openModal("verify-modal");
  };

}

$("#verify-form").addEventListener("submit", async event => {

  event.preventDefault();

  const message = $("#verify-message");
  const file = $("#admission-file").files[0];

  if (!supabase || !currentUser) {
    message.textContent = "Sign in first.";
    return;
  }

  if (!currentProfile?.university_id) {
    message.textContent = "Your university profile is incomplete.";
    return;
  }

  if (!file) {
    message.textContent = "Select your admission letter.";
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    message.textContent = "Maximum document size is 10 MB.";
    return;
  }

  if (![
    "application/pdf",
    "image/jpeg",
    "image/png"
  ].includes(file.type)) {
    message.textContent = "Only PDF, JPG and PNG are accepted.";
    return;
  }

  message.textContent = "Uploading document...";

  const path =
    `${currentUser.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const upload = await supabase.storage
    .from("admission-documents")
    .upload(path, file);

  if (upload.error) {
    message.textContent = upload.error.message;
    return;
  }

  const { error } = await supabase
    .from("admission_verifications")
    .insert({
      user_id: currentUser.id,
      university_id: currentProfile.university_id,
      document_path: path
    });

  if (error) {
    message.textContent = error.message;
    return;
  }

  message.textContent =
    "Your admission letter has been submitted for review.";

});

// LOAD SOCIAL FEED
async function loadFeed() {

  if (!supabase || !currentUser) {

    $("#feed-list").innerHTML = `
      <div class="empty">
        <div class="empty-icon">✦</div>
        <h3>Your campus universe starts here</h3>
        <p>Join CAMPVERSE to see your student community.</p>
        <button class="gold" id="empty-join">Join CAMPVERSE</button>
      </div>
    `;

    $("#empty-join").onclick = () => openModal("auth-modal");

    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("verification_status")
    .eq("id", currentUser.id)
    .single();

  if (profile?.verification_status !== "approved") {
    showVerificationPrompt();
    return;
  }

  const { data, error } = await supabase
    .from("posts")
    .select(`
      id,
      body,
      media_path,
      media_type,
      created_at,
      author:profiles(full_name,username,avatar_url)
    `)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    $("#feed-list").textContent = error.message;
    return;
  }

  if (!data.length) {
    $("#feed-list").innerHTML = `
      <div class="empty">
        <h3>No posts yet</h3>
        <p>Be the first to share a campus moment.</p>
      </div>
    `;
    return;
  }

  $("#feed-list").innerHTML = data.map(post => `
    <article class="panel post">

      <b>${esc(post.author?.full_name || "Student")}</b>

      <p>${esc(post.body)}</p>

      <small class="muted">
        ${new Date(post.created_at).toLocaleString()}
      </small>

      <div class="post-actions">
        <button data-like="${esc(post.id)}">♡ Like</button>
        <button data-comment="${esc(post.id)}">Comment</button>
      </div>

    </article>
  `).join("");

  document.querySelectorAll("[data-like]").forEach(button => {
    button.onclick = () => toggleLike(button.dataset.like, button);
  });

  document.querySelectorAll("[data-comment]").forEach(button => {
    button.onclick = () => commentOn(button.dataset.comment);
  });

}

// LIKE A POST
async function toggleLike(postId, button) {

  const { data: existing } = await supabase
    .from("post_likes")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", currentUser.id)
    .maybeSingle();

  const result = existing
    ? await supabase.from("post_likes")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", currentUser.id)
    : await supabase.from("post_likes")
        .insert({
          post_id: postId,
          user_id: currentUser.id
        });

  if (result.error) {
    alert(result.error.message);
    return;
  }

  button.textContent = existing ? "♡ Like" : "♥ Liked";

}

// COMMENT ON POST
async function commentOn(postId) {

  const body = prompt("Write your comment:");

  if (!body?.trim()) return;

  const { error } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      author_id: currentUser.id,
      body: body.trim().slice(0, 1000)
    });

  if (error) {
    alert(error.message);
  } else {
    alert("Comment posted.");
  }

}

// CREATE POST
$("#post-form").addEventListener("submit", async event => {

  event.preventDefault();

  const message = $("#post-message");

  if (!supabase || !currentUser) {
    message.textContent = "Sign in first.";
    return;
  }

  if (currentProfile?.verification_status !== "approved") {
    message.textContent = "Your student account must be verified first.";
    return;
  }

  const body = $("#post-body").value.trim();
  const file = $("#post-file").files[0];

  if (!body && !file) {
    message.textContent = "Write something or attach media.";
    return;
  }

  message.textContent = "Publishing...";

  let media_path = null;
  let media_type = null;

  if (file) {

    if (file.size > 100 * 1024 * 1024) {
      message.textContent = "Maximum media size is 100 MB.";
      return;
    }

    media_type = file.type.startsWith("video/")
      ? "video"
      : "image";

    const path =
      `${currentUser.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    const upload = await supabase.storage
      .from("campus-media")
      .upload(path, file);

    if (upload.error) {
      message.textContent = upload.error.message;
      return;
    }

    media_path = path;

  }

  const { error } = await supabase
    .from("posts")
    .insert({
      author_id: currentUser.id,
      body,
      media_path,
      media_type,
      visibility: "university"
    });

  if (error) {
    message.textContent = error.message;
    return;
  }

  message.textContent = "Post published!";

  event.target.reset();

  await loadFeed();

});

// FEED FILTER TABS
document.querySelectorAll("[data-feed]").forEach(button => {

  button.onclick = () => {

    document.querySelectorAll("[data-feed]").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    loadFeed();

  };

});

// SEARCH PLACEHOLDER
$("#search").addEventListener("keydown", event => {

  if (event.key === "Enter") {
    alert("Connect the database search module to enable live results.");
  }

});

// NOTIFICATIONS PLACEHOLDER
$("#notifications").onclick = () => {
  alert("Notifications will be connected to the notification service.");
};

// START APPLICATION
await loadUniversities();
await refreshSession();
await loadFeed();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(console.error);
}
