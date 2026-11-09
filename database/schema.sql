CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE universities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    city TEXT,
    state TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    username TEXT UNIQUE,
    avatar_url TEXT,
    bio TEXT,
    university_id UUID REFERENCES universities(id),
    verification_status TEXT DEFAULT 'pending'
        CHECK (verification_status IN ('pending','approved','rejected','needs_review')),
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE admission_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    university_id UUID REFERENCES universities(id),
    document_path TEXT NOT NULL,
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','needs_review')),
    reviewer_id UUID REFERENCES profiles(id),
    reviewer_note TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    body TEXT DEFAULT '',
    media_path TEXT,
    media_type TEXT,
    visibility TEXT DEFAULT 'university',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (LENGTH(body) <= 2000)
);

CREATE TABLE post_likes (
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    author_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE follows (
    follower_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    following_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id)
);

CREATE TABLE stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    media_path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_group BOOLEAN DEFAULT FALSE,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversation_members (
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES profiles(id),
    body TEXT,
    media_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (body IS NOT NULL OR media_path IS NOT NULL)
);

CREATE TABLE call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id UUID REFERENCES profiles(id),
    callee_id UUID REFERENCES profiles(id),
    status TEXT DEFAULT 'ringing',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

CREATE TABLE live_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID REFERENCES profiles(id),
    title TEXT NOT NULL,
    provider_room_id TEXT,
    playback_url TEXT,
    status TEXT DEFAULT 'scheduled',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE wallets (
    user_id UUID PRIMARY KEY REFERENCES profiles(id),
    coin_balance BIGINT DEFAULT 0 CHECK (coin_balance >= 0),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id),
    kind TEXT NOT NULL,
    amount_kobo BIGINT DEFAULT 0,
    coins BIGINT DEFAULT 0,
    reference TEXT UNIQUE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    coin_price BIGINT NOT NULL,
    image_path TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE gift_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES profiles(id),
    recipient_id UUID REFERENCES profiles(id),
    live_room_id UUID REFERENCES live_rooms(id),
    gift_id UUID REFERENCES gifts(id),
    quantity INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PERFORMANCE INDEXES

CREATE INDEX posts_created_idx
ON posts(created_at DESC);

CREATE INDEX posts_author_idx
ON posts(author_id, created_at DESC);

CREATE INDEX comments_post_idx
ON comments(post_id, created_at);

CREATE INDEX messages_conversation_idx
ON messages(conversation_id, created_at DESC);

CREATE INDEX stories_expiry_idx
ON stories(expires_at);

CREATE INDEX profiles_university_idx
ON profiles(university_id);

CREATE INDEX verification_status_idx
ON admission_verifications(status, submitted_at);

-- AUTOMATIC PROFILE CREATION

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    INSERT INTO public.profiles (
        id,
        full_name,
        university_id
    )
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            'New Student'
        ),
        NULLIF(
            NEW.raw_user_meta_data->>'university_id',
            ''
        )::UUID
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.wallets(user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;

END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE PROCEDURE public.handle_new_user();

-- ENABLE ROW LEVEL SECURITY

ALTER TABLE universities ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_events ENABLE ROW LEVEL SECURITY;

-- UNIVERSITY DIRECTORY

CREATE POLICY universities_read
ON universities FOR SELECT
USING (is_active = TRUE);

-- STUDENT PROFILES

CREATE POLICY profiles_read
ON profiles FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY profiles_insert
ON profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update
ON profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- ADMISSION VERIFICATION

CREATE POLICY verification_read
ON admission_verifications FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY verification_insert
ON admission_verifications FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- POSTS

CREATE POLICY posts_read
ON posts FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.verification_status = 'approved'
    )
);

CREATE POLICY posts_insert
ON posts FOR INSERT
TO authenticated
WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.verification_status = 'approved'
    )
);

CREATE POLICY posts_update
ON posts FOR UPDATE
TO authenticated
USING (author_id = auth.uid())
WITH CHECK (author_id = auth.uid());

CREATE POLICY posts_delete
ON posts FOR DELETE
TO authenticated
USING (author_id = auth.uid());

-- LIKES

CREATE POLICY likes_read
ON post_likes FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY likes_insert
ON post_likes FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY likes_delete
ON post_likes FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- COMMENTS

CREATE POLICY comments_read
ON comments FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY comments_insert
ON comments FOR INSERT
TO authenticated
WITH CHECK (author_id = auth.uid());

-- FOLLOWS

CREATE POLICY follows_read
ON follows FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY follows_insert
ON follows FOR INSERT
TO authenticated
WITH CHECK (follower_id = auth.uid());

CREATE POLICY follows_delete
ON follows FOR DELETE
TO authenticated
USING (follower_id = auth.uid());

-- STORIES

CREATE POLICY stories_read
ON stories FOR SELECT
TO authenticated
USING (expires_at > NOW());

CREATE POLICY stories_insert
ON stories FOR INSERT
TO authenticated
WITH CHECK (author_id = auth.uid());

-- PRIVATE WALLET ACCESS

CREATE POLICY wallets_read
ON wallets FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY transactions_read
ON wallet_transactions FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY gifts_read
ON gifts FOR SELECT
TO authenticated
USING (is_active = TRUE);

-- CONVERSATION ACCESS

CREATE POLICY conversation_member_read
ON conversation_members FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY message_read
ON messages FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM conversation_members
        WHERE conversation_members.conversation_id =
        messages.conversation_id
        AND conversation_members.user_id = auth.uid()
    )
);

CREATE POLICY message_send
ON messages FOR INSERT
TO authenticated
WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM conversation_members
        WHERE conversation_members.conversation_id =
        messages.conversation_id
        AND conversation_members.user_id = auth.uid()
    )
);

-- CALL ACCESS

CREATE POLICY calls_read
ON call_sessions FOR SELECT
TO authenticated
USING (
    caller_id = auth.uid()
    OR callee_id = auth.uid()
);

CREATE POLICY calls_create
ON call_sessions FOR INSERT
TO authenticated
WITH CHECK (caller_id = auth.uid());

-- LIVE ROOMS

CREATE POLICY live_rooms_read
ON live_rooms FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY live_rooms_create
ON live_rooms FOR INSERT
TO authenticated
WITH CHECK (host_id = auth.uid());

-- GIFTS

CREATE POLICY gift_events_read
ON gift_events FOR SELECT
TO authenticated
USING (sender_id = auth.uid() OR recipient_id = auth.uid());
