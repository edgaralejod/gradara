within;
package Gradara
block Component_reference
  Modelica.Blocks.Interfaces.RealOutput y;
  parameter Real height = 100;
  parameter Real startTime = 0.2;
equation
  y = if time < startTime then 0 else height;
end Component_reference;
block Component_controller
  Modelica.Blocks.Interfaces.RealInput reference;
  Modelica.Blocks.Interfaces.RealInput measured;
  Modelica.Blocks.Interfaces.RealOutput y;
  parameter Real kp = 0.6;
  parameter Real ki = 2;
  parameter Real limit = 24;
  parameter Real samplePeriod = 0.001;
  discrete Real integral(start=0, fixed=true);
  Real error;
equation
  error = reference - measured;
  when sample(0, samplePeriod) then
    integral = max(-limit, min(limit, pre(integral) + samplePeriod*ki*error));
    y = max(-limit, min(limit, kp*error + integral));
  end when;
end Component_controller;
model Component_drive
  Modelica.Blocks.Interfaces.RealInput u;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
 equation
  p.v - n.v = u;
  p.i + n.i = 0;
 end Component_drive;
model Component_motor
  parameter Real R=1.2;
  parameter Real L=0.02;
  parameter Real k=0.15;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  Modelica.Mechanics.Rotational.Interfaces.Flange_b flange;
  Real i(start=0, fixed=true);
  Real v;
  Real w;
 equation
  p.i = i;
  p.i + n.i = 0;
  v = p.v-n.v;
  w = der(flange.phi);
  L*der(i) = v-R*i-k*w;
  flange.tau = -k*i;
 end Component_motor;
model Component_load
  parameter Real J=0.02;
  parameter Real damping=0.002;
  Modelica.Mechanics.Rotational.Interfaces.Flange_a a;
  Modelica.Mechanics.Rotational.Interfaces.Flange_b b;
  Real phi(start=0, fixed=true);
  Real w(start=0, fixed=true);
 equation
  a.phi = phi;
  b.phi = phi;
  der(phi) = w;
  J*der(w) = a.tau+b.tau-damping*w;
 end Component_load;
model Component_sensor
  Modelica.Mechanics.Rotational.Interfaces.Flange_a flange;
  Modelica.Blocks.Interfaces.RealOutput y;
 equation
  y = der(flange.phi);
  flange.tau = 0;
 end Component_sensor;
model Component_ground
  extends Modelica.Electrical.Analog.Basic.Ground;
 end Component_ground;
model System
  Component_reference reference(height=100, startTime=0.2);
  Component_controller controller(kp=0.6, ki=2, limit=24, samplePeriod=0.001);
  Component_drive drive();
  Component_motor motor(R=1.2, L=0.02, k=0.15);
  Component_load load(J=0.02, damping=0.002);
  Component_sensor sensor();
  Component_ground ground();
equation
  connect(reference.y, controller.reference);
  connect(controller.y, drive.u);
  connect(drive.p, motor.p);
  connect(drive.n, ground.p);
  connect(motor.n, ground.p);
  connect(motor.flange, load.a);
  connect(load.b, sensor.flange);
  connect(sensor.y, controller.measured);
  annotation(experiment(StartTime=0, StopTime=4.0, Tolerance=1e-6));
end System;
end Gradara;
