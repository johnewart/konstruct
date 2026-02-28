module.exports = {
  "src/**/*.{ts,tsx}": [
    "eslint --fix",
    "prettier --write",
    "git add"
  ],
  "src/**/*.{css,html,json}": [
    "prettier --write",
    "git add"
  ]
};