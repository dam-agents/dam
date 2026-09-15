package vmrunner

type Runtime interface {
	State(id string) (string, error)
	Create(id string, spec MachineSpec, image string, hostPort int, caDir string) error
	Start(id string) error
	Stop(id string) error
	Update(id string, spec MachineSpec, applied *MachineSpec) error
	Delete(id string) error
}
