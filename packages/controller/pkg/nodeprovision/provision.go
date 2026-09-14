package nodeprovision

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
)

type Config struct {
	Host          string
	SSHPort       int
	SSHUser       string
	SSHKey        []byte
	SSHHostKey    string
	Token         string
	TLSCert       []byte
	TLSKey        []byte
	SmolvmVersion string
	ServiceCIDR   string
	RouteVia      string
	AllowFrom     []string
	BinaryDir     string
}

func ConfigFromEnv() (Config, error) {
	port, _ := strconv.Atoi(env("NODE_SSH_PORT", "22"))
	c := Config{
		Host: os.Getenv("NODE_HOST"), SSHPort: port, SSHUser: os.Getenv("NODE_SSH_USER"), SSHKey: []byte(os.Getenv("NODE_SSH_KEY")),
		SSHHostKey: os.Getenv("NODE_SSH_HOST_KEY"), Token: os.Getenv("NODE_TOKEN"),
		TLSCert: []byte(os.Getenv("NODE_TLS_CERT")), TLSKey: []byte(os.Getenv("NODE_TLS_KEY")),
		SmolvmVersion: env("SMOLVM_VERSION", "1.16.0"), ServiceCIDR: os.Getenv("SERVICE_CIDR"), RouteVia: os.Getenv("ROUTE_VIA"),
		BinaryDir: env("SANDBOX_NODE_BINARY_DIR", "/usr/local/lib/platform"),
	}
	if v := os.Getenv("NODE_INGRESS_CIDRS"); v != "" {
		c.AllowFrom = strings.Split(v, ",")
	}
	for k, v := range map[string]string{"NODE_HOST": c.Host, "NODE_SSH_USER": c.SSHUser, "NODE_SSH_KEY": string(c.SSHKey), "NODE_TOKEN": c.Token} {
		if v == "" {
			return c, fmt.Errorf("%s is required", k)
		}
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func (c *Config) DiscoverCluster(ctx context.Context, kube kubernetes.Interface, dyn dynamic.Interface) error {
	nodes, err := kube.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("listing nodes: %w", err)
	}
	for _, n := range nodes.Items {
		for _, a := range n.Status.Addresses {
			if a.Type == "InternalIP" && net.ParseIP(a.Address) != nil {
				c.AllowFrom = append(c.AllowFrom, a.Address+"/32")
				if c.RouteVia == "" {
					c.RouteVia = a.Address
				}
			}
		}
	}
	if c.ServiceCIDR != "" {
		return nil
	}
	cidrs, err := dyn.Resource(schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "servicecidrs"}).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("listing servicecidrs (set SERVICE_CIDR when the API is unavailable): %w", err)
	}
	for _, item := range cidrs.Items {
		list, _, _ := unstructured.NestedStringSlice(item.Object, "spec", "cidrs")
		for _, cidr := range list {
			if ip, _, err := net.ParseCIDR(cidr); err == nil && ip.To4() != nil {
				c.ServiceCIDR = cidr
				return nil
			}
		}
	}
	return fmt.Errorf("no IPv4 ServiceCIDR found; set SERVICE_CIDR")
}

func Run(ctx context.Context, c Config) error {
	signer, err := ssh.ParsePrivateKey(c.SSHKey)
	if err != nil {
		return fmt.Errorf("parsing ssh key: %w", err)
	}
	hostKeyCallback := ssh.InsecureIgnoreHostKey()
	if c.SSHHostKey != "" {
		pub, _, _, _, err := ssh.ParseAuthorizedKey([]byte(c.SSHHostKey))
		if err != nil {
			return fmt.Errorf("parsing ssh host key: %w", err)
		}
		hostKeyCallback = ssh.FixedHostKey(pub)
	}
	client, err := ssh.Dial("tcp", net.JoinHostPort(c.Host, strconv.Itoa(c.SSHPort)), &ssh.ClientConfig{
		User: c.SSHUser, Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)}, HostKeyCallback: hostKeyCallback, Timeout: 30 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("ssh %s@%s: %w", c.SSHUser, c.Host, err)
	}
	defer client.Close()
	s := session{client}

	arch, err := s.output("uname -m")
	if err != nil {
		return err
	}
	goarch := map[string]string{"x86_64": "amd64", "aarch64": "arm64"}[strings.TrimSpace(arch)]
	if goarch == "" {
		return fmt.Errorf("unsupported node architecture %q", strings.TrimSpace(arch))
	}
	binary, err := os.ReadFile(c.BinaryDir + "/sandbox-node-" + goarch)
	if err != nil {
		return fmt.Errorf("sandbox-node binary for %s: %w", goarch, err)
	}
	slog.Info("provisioning sandbox node", "host", c.Host, "arch", goarch, "routeVia", c.RouteVia, "serviceCidr", c.ServiceCIDR, "allowFrom", c.AllowFrom)

	files := map[string][]byte{
		"/usr/local/bin/sandbox-node.new": binary,
		"/etc/platform-sandbox/token":     []byte(c.Token + "\n"),
		"/etc/platform-sandbox/tls.crt":   c.TLSCert,
		"/etc/platform-sandbox/tls.key":   c.TLSKey,
		"/etc/systemd/system/sandbox-node.service": []byte(fmt.Sprintf(`[Unit]
Description=Platform sandbox node (vm-backend machine API)
After=network-online.target
[Service]
Environment=HOME=/var/lib/smolvm
ExecStart=/usr/local/bin/sandbox-node --smolvm /var/lib/smolvm/.smolvm/smolvm --token-file /etc/platform-sandbox/token%s --allow-from %s
Restart=always
[Install]
WantedBy=multi-user.target
`, tlsFlags(c), strings.Join(c.AllowFrom, ","))),
		"/etc/systemd/system/platform-sandbox-route.service": []byte(fmt.Sprintf(`[Unit]
Description=Route the cluster Service CIDR through a Kubernetes node (platform sandbox node)
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'ip route replace %s via %s'
[Install]
WantedBy=multi-user.target
`, c.ServiceCIDR, c.RouteVia)),
		"/etc/udev/rules.d/99-platform-kvm.rules": []byte("KERNEL==\"kvm\", MODE=\"0666\"\n"),
	}
	if err := s.run("mkdir -p /etc/platform-sandbox /var/lib/platform-sandbox/images && chmod 700 /etc/platform-sandbox"); err != nil {
		return err
	}
	for path, content := range files {
		if err := s.upload(path, content); err != nil {
			return err
		}
	}
	script := fmt.Sprintf(`set -e
chmod 755 /usr/local/bin/sandbox-node.new && mv /usr/local/bin/sandbox-node.new /usr/local/bin/sandbox-node
chmod 644 /etc/platform-sandbox/tls.crt; chmod 600 /etc/platform-sandbox/tls.key /etc/platform-sandbox/token
chmod 666 /dev/kvm
if [ "$(cat /var/lib/smolvm/.smolvm/.version 2>/dev/null)" != "%[1]s" ]; then
  mkdir -p /var/lib/smolvm && chmod 755 /var/lib/smolvm
  (umask 022; HOME=/var/lib/smolvm bash -c 'curl -sSL https://smolmachines.com/install.sh | bash -s -- --version %[1]s' >/dev/null)
  chmod -R a+rX /var/lib/smolvm
fi
systemctl daemon-reload
systemctl enable --now platform-sandbox-route >/dev/null 2>&1
systemctl restart platform-sandbox-route
systemctl enable sandbox-node >/dev/null 2>&1
systemctl restart sandbox-node
for i in $(seq 1 30); do systemctl is-active --quiet sandbox-node && curl -sk -o /dev/null -w '%%{http_code}' -H 'Authorization: Bearer %[2]s' https://127.0.0.1:4600/machines/probe | grep -q 200 && exit 0; sleep 1; done
echo "sandbox-node did not come up:" >&2; journalctl -u sandbox-node -n 20 --no-pager >&2; exit 1
`, c.SmolvmVersion, c.Token)
	if len(c.TLSCert) == 0 {
		script = strings.ReplaceAll(script, "https://127.0.0.1:4600", "http://127.0.0.1:4600")
	}
	return s.run(script)
}

func tlsFlags(c Config) string {
	if len(c.TLSCert) == 0 {
		return ""
	}
	return " --tls-cert /etc/platform-sandbox/tls.crt --tls-key /etc/platform-sandbox/tls.key"
}

type session struct{ client *ssh.Client }

func (s session) run(script string) error {
	_, err := s.exec(script, nil)
	return err
}

func (s session) output(cmd string) (string, error) {
	return s.exec(cmd, nil)
}

func (s session) upload(path string, content []byte) error {
	_, err := s.exec(fmt.Sprintf("cat > %q", path), content)
	return err
}

func (s session) exec(script string, stdin []byte) (string, error) {
	sess, err := s.client.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()
	var out, errOut bytes.Buffer
	sess.Stdout, sess.Stderr = &out, &errOut
	if stdin != nil {
		sess.Stdin = bytes.NewReader(stdin)
	}
	if err := sess.Run("sudo -n bash -c " + shellQuote(script)); err != nil {
		return out.String(), fmt.Errorf("on %s: %w\n%s%s", "node", err, out.String(), errOut.String())
	}
	return out.String(), nil
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
