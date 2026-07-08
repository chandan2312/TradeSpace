# TradeSpace Deployment Manual (Windows RDP)

This guide walks you through deploying the TradeSpace Next.js application directly onto your Windows RDP server where your MetaTrader 5 terminal is currently running. 

Running the UI backend on the same machine as the MT5 bridge guarantees **0ms network latency** for market data and ensures your automated alert polling runs 24/7.

---

## 1. Prerequisites (Install on Windows RDP)

Log into your Windows RDP server and download/install the following:
1. **Node.js (LTS Version):** [Download Here](https://nodejs.org/)
2. **Git for Windows:** [Download Here](https://git-scm.com/download/win)

---

## 2. Authenticating & Cloning Your Private GitHub Repo

Because your repository is private, you cannot clone it normally without authenticating. The easiest way to authenticate on a remote Windows server is by using a **GitHub Personal Access Token (PAT)**.

### A. Generate a Personal Access Token
1. On your local PC, go to [GitHub Settings -> Developer Settings -> Personal Access Tokens -> Tokens (classic)](https://github.com/settings/tokens).
2. Click **Generate new token (classic)**.
3. Give it a note (e.g., "RDP Server").
4. Under **Select scopes**, check the box for **`repo`** (Full control of private repositories).
5. Click **Generate token** at the bottom.
6. **Copy the token immediately** (it starts with `ghp_...`). You will not be able to see it again.

### B. Clone the Repository on the RDP
1. On your Windows RDP, open **Command Prompt** (`cmd`).
2. Navigate to where you want to store the project (e.g., `cd C:\Users\Administrator\Desktop`).
3. Clone the repository using your username and the token you just generated. Replace `<username>`, `<token>`, and `<repo-name>` below:

```bash
git clone https://<username>:<token>@github.com/<username>/<repo-name>.git
```
*(Example: `git clone https://chandan23:ghp_abC123...xyz@github.com/chandan23/TradeSpace.git`)*

4. Move into the project folder:
```bash
cd <repo-name>
```

---

## 3. Configure the Environment Variables

Because the app is now running on the exact same computer as your MT5 Python script, it needs to connect locally instead of going over the internet.

1. On your local PC, open your `.env` or `.env.local` file and copy everything inside it.
2. On the RDP server, create a new file named `.env` inside the project folder.
3. Paste the contents into the new `.env` file.
4. **CRITICAL CHANGE:** Find the `NEXUS_MT5_REMOTE_URL` line and change it to `127.0.0.1` so it connects to the MT5 bridge internally:

```env
NEXUS_MT5_REMOTE_URL=http://127.0.0.1:8765
```
*(Leave your MongoDB connection string exactly as it is. It will connect seamlessly to your cloud database).*

---

## 4. Install & Build the App

Inside the Command Prompt (make sure you are in the project folder):

```bash
# 1. Install all Node modules
npm install

# 2. Build the optimized production version of the app
npm run build
```

---

## 5. Keep the Server Running 24/7 (PM2)

If you just run `npm run start`, the server will shut down as soon as you close the command prompt window. To keep it running permanently in the background, we use a process manager called **PM2**.

```bash
# 1. Install PM2 globally on the Windows server
npm install -g pm2

# 2. Start the TradeSpace backend via PM2
pm2 start npm --name "tradespace" -- run start

# 3. Tell PM2 to save the current process list so it restarts if the server reboots
pm2 save
```

Your backend is now officially running. You can close the command prompt, and it will stay alive.
*Note: You can view the live console logs at any time by typing `pm2 logs tradespace`.*

---

## 6. Open Port 3000 (Windows Firewall)

By default, Windows blocks incoming connections. To view your TradeSpace dashboard from your local computer or phone, you must open port `3000`.

1. On the RDP, search the start menu for **"Windows Defender Firewall with Advanced Security"** and open it.
2. In the left panel, click **Inbound Rules**.
3. In the right panel, click **New Rule...**
4. Select **Port** and click Next.
5. Select **TCP** and type `3000` into the "Specific local ports" box. Click Next.
6. Select **Allow the connection**. Click Next.
7. Leave Domain, Private, and Public checked. Click Next.
8. Name it `TradeSpace Port 3000` and click Finish.

---

## 7. Success!

You can now open a browser on your local laptop or mobile phone and navigate to:
`http://<YOUR_RDP_PUBLIC_IP>:3000`

Whenever you push new code changes from your local PC to GitHub, simply log into the RDP, open a command prompt in the project folder, and run:
```bash
git pull
npm run build
pm2 restart tradespace
```
