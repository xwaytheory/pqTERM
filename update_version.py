with open(r'C:\Users\pq\pqTERM-dev\crates\pq-core\src\updater.rs', 'r') as f:
    content = f.read()

# Replace all 1.1.4 -> 1.1.5 in test fixtures
content = content.replace('"1.1.4"', '"1.1.5"')
content = content.replace('v1.1.4', 'v1.1.5')
content = content.replace('pq 1.1.4', 'pq 1.1.5')
content = content.replace('pq Setup 1.1.4', 'pq Setup 1.1.5')
content = content.replace('pq-Setup-1.1.4', 'pq-Setup-1.1.5')
content = content.replace('pq-1.1.4', 'pq-1.1.5')
content = content.replace('1.1.3", &m.latest', '1.1.4", &m.latest')
content = content.replace('offer_from_manifest("1.1.4"', 'offer_from_manifest("1.1.5"')

with open(r'C:\Users\pq\pqTERM-dev\crates\pq-core\src\updater.rs', 'w') as f:
    f.write(content)
print('Done')