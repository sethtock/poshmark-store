# Poshmark Browser Test — Use OpenClaw Browser Tool

## Photos (local server paths)
- /home/openclaw/.openclaw/media/inbound/file_1---50ba37bf-a882-4617-90f0-82d9d1e69055.jpg
- /home/openclaw/.openclaw/media/inbound/file_2---cda54736-26b3-45cb-ae00-818ff0a5b51d.jpg
- /home/openclaw/.openclaw/media/inbound/file_3---5f19a006-ada8-4bdd-b243-1c41e347d4f5.jpg

## Steps to run via browser tool
1. Navigate to poshmark.com/login
2. Login with the `POSHMARK_EMAIL` / `POSHMARK_PASSWORD` env vars
3. If prompted, use the documented two-step OTP flow from `docs/poshmark-auth.md`
4. Navigate to `https://poshmark.com/sell` (redirects to `/create-listing`)
5. Upload all 3 photos
6. Fill: title, description, brand (Jacadi), size (6M), price ($75), condition (NWT)
7. Publish and capture URL

## Listing data
- Title: Jacadi Baby Snowsuit 6M Blue White Green NWT
- Price: $75
- Brand: Jacadi
- Size: 6M
- Condition: New with Tags
- Description: [as agreed]
