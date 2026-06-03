# ngrok

## installation

```
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com bookworm main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update
sudo apt install ngrok
```

## run

```
ngrok config add-authtoken 1YsginS8boQtkrnDsi9ynyz5u1u_3aWBKGELfaULN4GCwfSPf

ngrok http 3000
```

