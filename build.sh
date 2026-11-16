set -e
cd /home/claude/app
rm -rf dist && mkdir dist
npx esbuild js/patient.js js/therapist.js --bundle --minify --format=esm --splitting --target=es2020 --outdir=dist/js --external:https://* --charset=utf8 --log-level=warning --chunk-names=c-[hash] --entry-names=[name]
cp css/style.css dist/style.css
V=$(date +%s)
sed "s#<script src=\"/therapist.js?v=1\"></script>#<script type=\"module\" src=\"/js/therapist.js\"></script>#; s/?v=1/?v=$V/g" index.src.html > dist/index.html
sed "s#<script src=\"/patient.js?v=1\"></script>#<script type=\"module\" src=\"/js/patient.js\"></script>#; s/?v=1/?v=$V/g" f.src.html > dist/f.html
printf '%s' '{"headers":[{"source":"/(.*)","headers":[{"key":"X-Frame-Options","value":"DENY"},{"key":"Referrer-Policy","value":"no-referrer"},{"key":"X-Content-Type-Options","value":"nosniff"},{"key":"X-Robots-Tag","value":"noindex"}]},{"source":"/js/(.*)","headers":[{"key":"Cache-Control","value":"no-cache"}]}]}' > dist/vercel.json
find dist -type f -exec ls -la {} \; | awk '{print $5, $9}'
