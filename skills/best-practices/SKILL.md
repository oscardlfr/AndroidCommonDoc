---
name: best-practices
description: "Web security, compatibility, and code quality patterns. Background knowledge for CSP, HTTPS, deprecated APIs, and modern standards."
allowed-tools: [Read, Grep, Glob, Bash]
user-invocable: false
---

# Best practices

Modern web development standards based on Lighthouse best practices audits. Covers security, browser compatibility, and code quality patterns.

## Security

### HTTPS everywhere

**Enforce HTTPS:**
```html
<!-- Bad: Mixed content -->
<img src="http://example.com/image.jpg">
<script src="http://cdn.example.com/script.js"></script>

<!-- Good: HTTPS only -->
<img src="https://example.com/image.jpg">
<script src="https://cdn.example.com/script.js"></script>

<!-- Good: Protocol-relative (will use page's protocol) -->
<img src="//example.com/image.jpg">
```

**HSTS Header:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### Content Security Policy (CSP)

```html
<!-- Basic CSP via meta tag -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' https://trusted-cdn.com;
               style-src 'self' 'unsafe-inline';
               img-src 'self' data: https:;
               connect-src 'self' https://api.example.com;">

<!-- Better: HTTP header -->
```

**CSP Header (recommended):**
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-abc123' https://trusted.com;
  style-src 'self' 'nonce-abc123';
  img-src 'self' data: https:;
  connect-src 'self' https://api.example.com;
  frame-ancestors 'self';
  base-uri 'self';
  form-action 'self';
```

**Using nonces for inline scripts:**
```html
<script nonce="abc123">
  // This inline script is allowed
</script>
```

### Security headers

```
# Prevent clickjacking
X-Frame-Options: DENY

# Prevent MIME type sniffing
X-Content-Type-Options: nosniff

# Enable XSS filter (legacy browsers)
X-XSS-Protection: 1; mode=block

# Control referrer information
Referrer-Policy: strict-origin-when-cross-origin

# Permissions policy (formerly Feature-Policy)
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

### No vulnerable libraries

```bash
# Check for vulnerabilities
npm audit
yarn audit

# Auto-fix when possible
npm audit fix

# Check specific package
npm ls lodash
```

**Keep dependencies updated:**
```json
{
  "scripts": {
    "audit": "npm audit --audit-level=moderate",
    "update": "npm update && npm audit fix"
  }
}
```

**Known vulnerable patterns to avoid:**
```javascript
// Bad: Prototype pollution vulnerable patterns
Object.assign(target, userInput);
_.merge(target, userInput);

// Good: Safer alternatives
const safeData = JSON.parse(JSON.stringify(userInput));
```

### Input sanitization

Always use safe DOM methods:
- Use `element.textContent` for plain text (safe)
- Never inject raw user input as HTML
- If HTML rendering is needed, use a sanitizer library like DOMPurify

### Secure cookies

```
# Good: Secure cookie (server-side header)
Set-Cookie: session=abc123; Secure; HttpOnly; SameSite=Strict; Path=/
```

---

## Browser compatibility

### Doctype declaration

```html
<!-- Bad: Missing or invalid doctype -->
<HTML>

<!-- Good: HTML5 doctype -->
<!DOCTYPE html>
<html lang="en">
```

### Character encoding

```html
<!-- Bad: Missing or late charset -->
<html>
<head>
  <title>Page</title>
  <meta charset="UTF-8">
</head>

<!-- Good: Charset as first element in head -->
<html>
<head>
  <meta charset="UTF-8">
  <title>Page</title>
</head>
```

### Viewport meta tag

```html
<!-- Bad: Missing viewport -->
<head>
  <title>Page</title>
</head>

<!-- Good: Responsive viewport -->
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page</title>
</head>
```

### Feature detection

```javascript
// Bad: Browser detection (brittle)
if (navigator.userAgent.includes('Chrome')) {
  // Chrome-specific code
}

// Good: Feature detection
if ('IntersectionObserver' in window) {
  // Use IntersectionObserver
} else {
  // Fallback
}
```

```css
/* Good: Using @supports in CSS */
@supports (display: grid) {
  .container { display: grid; }
}
@supports not (display: grid) {
  .container { display: flex; }
}
```

---

## Deprecated APIs

### Avoid these

Use modern alternatives for deprecated browser APIs:
- **Blocking writes:** Use `document.createElement()` + `appendChild()` instead of legacy blocking methods
- **Synchronous XHR:** Use `fetch()` API (async by default)
- **Application Cache:** Use Service Workers for offline support

```javascript
// Good: Dynamic script loading
const script = document.createElement('script');
script.src = '...';
document.head.appendChild(script);

// Good: Async fetch
const response = await fetch(url);

// Good: Service Workers
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
```

### Event listener passive

```javascript
// Bad: Non-passive touch/wheel (may block scrolling)
element.addEventListener('touchstart', handler);
element.addEventListener('wheel', handler);

// Good: Passive listeners (allows smooth scrolling)
element.addEventListener('touchstart', handler, { passive: true });
element.addEventListener('wheel', handler, { passive: true });

// Good: If you need preventDefault, be explicit
element.addEventListener('touchstart', handler, { passive: false });
```

---

## Console & errors

### No console errors

```javascript
// Bad: Errors in production
console.log('Debug info'); // Remove in production
throw new Error('Unhandled'); // Catch all errors

// Good: Proper error handling
try {
  riskyOperation();
} catch (error) {
  errorTracker.captureException(error);
  showErrorMessage('Something went wrong. Please try again.');
}
```

### Error boundaries (React)

```jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    errorTracker.captureException(error, { extra: info });
  }

  render() {
    if (this.state.hasError) {
      return <FallbackUI />;
    }
    return this.props.children;
  }
}
```

### Global error handler

```javascript
// Catch unhandled errors
window.addEventListener('error', (event) => {
  errorTracker.captureException(event.error);
});

// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  errorTracker.captureException(event.reason);
});
```

---

## Source maps

### Production configuration

```javascript
// Bad: Source maps exposed in production
module.exports = { devtool: 'source-map' }; // Exposes source code

// Good: Hidden source maps (uploaded to error tracker)
module.exports = { devtool: 'hidden-source-map' };

// Good: Or no source maps in production
module.exports = {
  devtool: process.env.NODE_ENV === 'production' ? false : 'source-map',
};
```

---

## Performance best practices

### Avoid blocking patterns

```html
<!-- Bad: Blocking script -->
<script src="heavy-library.js"></script>

<!-- Good: Deferred script -->
<script defer src="heavy-library.js"></script>
```

Use `<link>` tags instead of CSS `@import` for parallel loading.

### Efficient event handlers

```javascript
// Bad: Handler on every element
items.forEach(item => {
  item.addEventListener('click', handleClick);
});

// Good: Event delegation
container.addEventListener('click', (e) => {
  if (e.target.matches('.item')) {
    handleClick(e);
  }
});
```

### Memory management

```javascript
// Bad: Memory leak (never removed)
const handler = () => { /* ... */ };
window.addEventListener('resize', handler);

// Good: Cleanup when done
window.removeEventListener('resize', handler);

// Good: Using AbortController
const controller = new AbortController();
window.addEventListener('resize', handler, { signal: controller.signal });
controller.abort(); // Cleanup
```

---

## Code quality

### Valid HTML

```html
<!-- Bad: Duplicate IDs, invalid nesting -->
<div id="header"></div>
<div id="header"></div>

<!-- Good: Unique IDs, proper structure -->
<header id="site-header"></header>

<ul><li>Item</li></ul>

<a href="/" class="button">Click</a>
```

### Semantic HTML

```html
<!-- Bad: Non-semantic divs -->
<div class="header"><div class="nav">...</div></div>

<!-- Good: Semantic HTML5 -->
<header><nav><a href="/">Home</a></nav></header>
<main><article><h1>Headline</h1></article></main>
```

### Image aspect ratios

```html
<!-- Bad: Distorted images -->
<img src="photo.jpg" width="300" height="100">

<!-- Good: Preserve aspect ratio -->
<img src="photo.jpg" width="300" height="225">

<!-- Good: CSS object-fit -->
<img src="photo.jpg" style="width: 300px; height: 200px; object-fit: cover;">
```

---

## Permissions & privacy

### Request permissions properly

```javascript
// Bad: Request on page load
navigator.geolocation.getCurrentPosition(success, error);

// Good: Request in context, after user action
findNearbyButton.addEventListener('click', async () => {
  if (await showPermissionExplanation()) {
    navigator.geolocation.getCurrentPosition(success, error);
  }
});
```

### Permissions policy

```html
<meta http-equiv="Permissions-Policy"
      content="geolocation=(), camera=(), microphone=()">
```

---

## Audit checklist

### Security (critical)
- [ ] HTTPS enabled, no mixed content
- [ ] No vulnerable dependencies (`npm audit`)
- [ ] CSP headers configured
- [ ] Security headers present
- [ ] No exposed source maps

### Compatibility
- [ ] Valid HTML5 doctype
- [ ] Charset declared first in head
- [ ] Viewport meta tag present
- [ ] No deprecated APIs used
- [ ] Passive event listeners for scroll/touch

### Code quality
- [ ] No console errors
- [ ] Valid HTML (no duplicate IDs)
- [ ] Semantic HTML elements used
- [ ] Proper error handling
- [ ] Memory cleanup in components

### UX
- [ ] No intrusive interstitials
- [ ] Permission requests in context
- [ ] Clear error messages
- [ ] Appropriate image aspect ratios

## Tools

| Tool | Purpose |
|------|---------|
| `npm audit` | Dependency vulnerabilities |
| [SecurityHeaders.com](https://securityheaders.com) | Header analysis |
| [W3C Validator](https://validator.w3.org) | HTML validation |
| Lighthouse | Best practices audit |
| [Observatory](https://observatory.mozilla.org) | Security scan |

## References

- [MDN Web Security](https://developer.mozilla.org/en-US/docs/Web/Security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Web Quality Audit](../web-quality-audit/SKILL.md)
