package publicationreader

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

var blockedNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
}

func publicIP(ip netip.Addr) bool {
	if ip.Zone() != "" {
		return false
	}
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, p := range blockedNetworks {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

func validateURL(u *url.URL) error {
	if u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Opaque != "" || len(u.String()) > 4096 {
		return failure(400, "provide a public HTTP(S) URL without credentials")
	}
	if port := u.Port(); port != "" && port != "80" && port != "443" {
		return failure(400, "URL port must be 80 or 443")
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && !publicIP(ip) {
		return failure(400, "URL must address a public host")
	}
	return nil
}

type lookupFunc func(context.Context, string) ([]netip.Addr, error)
type dialFunc func(context.Context, string, string) (net.Conn, error)

func publicDial(lookup lookupFunc, dial dialFunc) dialFunc {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, failure(400, "invalid public host")
		}
		ips, err := lookup(ctx, host)
		if err != nil || len(ips) == 0 {
			return nil, failure(400, "public host cannot be resolved")
		}
		// Validate the complete answer, then dial a checked numeric address directly.
		// The transport never performs a second DNS lookup (including on redirects).
		for _, ip := range ips {
			if !publicIP(ip) {
				return nil, failure(400, "URL must address a public host")
			}
		}
		for _, ip := range ips {
			conn, e := dial(ctx, network, net.JoinHostPort(ip.String(), port))
			if e == nil {
				return conn, nil
			}
			err = e
		}
		return nil, err
	}
}

func redirect(req *http.Request, via []*http.Request) error {
	if len(via) > 3 {
		return failure(400, "too many publication redirects")
	}
	if err := validateURL(req.URL); err != nil {
		return err
	}
	// No user credentials or cookies are ever forwarded, even across redirects.
	req.Header = http.Header{"Accept": []string{"application/pdf, text/plain, text/html"}}
	return nil
}

func NewFetchClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: publicDial(func(ctx context.Context, host string) ([]netip.Addr, error) {
			return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		}, dialer.DialContext),
		TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second,
		MaxResponseHeaderBytes: 32 << 10, DisableKeepAlives: true,
	}
	return &http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: redirect}
}

func Fetch(ctx context.Context, client *http.Client, rawURL string) (Document, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return Document{}, failure(400, "invalid publication URL")
	}
	if err = validateURL(u); err != nil {
		return Document{}, err
	}
	u.Fragment = ""
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return Document{}, failure(400, "invalid publication URL")
	}
	req.Header.Set("Accept", "application/pdf, text/plain, text/html")
	resp, err := client.Do(req)
	if err != nil {
		return Document{}, failure(422, "publication could not be fetched from a public host")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return Document{}, failure(422, "publication URL did not return a readable document")
	}
	data, err := ReadBounded(resp.Body, MaxSourceBytes)
	if err != nil {
		return Document{}, err
	}
	d, err := Extract(ctx, data, resp.Header.Get("Content-Type"), resp.Request.URL.Hostname())
	if err != nil {
		return d, err
	}
	d.SourceURL = resp.Request.URL.String()
	return d, nil
}
