# WamsTube
Your community. Your creativity.
WamsTube is a video-sharing project built for the Wams Middle School community. It gives students a place to share videos, discover creators, and connect through a school-focused platform.
Features

Upload and watch videos
Mark videos as Shorts and browse them in a vertical feed
Like videos, comment, and subscribe to channels
Save videos to playlists and watch later
Start livestreams with camera and microphone access
Customize channels
Use Wams Bucks and WamsTube Plus features

Setup
WamsTube uses Supabase for authentication, database services, and media storage.

Clone or download this repository.
Add your Supabase project URL and anon key to supabase-config.js.
Run supabase.sql in the Supabase SQL Editor.
Set up the Storage buckets and policies described in the SQL file.
Serve the site locally or deploy it to a host with HTTPS.

Camera and microphone access for livestreaming requires HTTPS or localhost.
Main files

index.html — home page
watch.html — video player, likes, and comments
shorts.html — Shorts feed
live.html — livestream page
channel.html — channel page
admin.html — admin tools
styles.css — shared styles
script.js — shared site functionality
auth.js — authentication and account handling
browse.js and browse.css — browse pages
watch.js — video player and engagement features
admin.js — admin functionality
supabase.sql — database setup and policies

WamsTube is a school-focused project. Please follow school rules when creating, uploading, and sharing content.
The project is under development, and features or setup instructions may change.
